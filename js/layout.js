import { TITULO_SISTEMA } from './config.js?v=202611261211';
import { sair } from './auth.js?v=202611261211';
import { esc } from './util.js?v=202611261211';

// Menu do administrador. "pronto: false" = tela ainda não entregue.
const MENU_ADM = [
  { tipo: 'link', id: 'inicio', rotulo: 'Dashboard', href: 'inicio.html', pronto: true },
  { tipo: 'grupo', id: 'planejamento', rotulo: 'Planejamento', itens: [
    { id: 'montar', rotulo: 'Montar horário', href: 'montar.html' },
    { id: 'pos', rotulo: 'Planejamento da pós', href: 'pos.html' },
    { id: 'carga', rotulo: 'Carga docente', href: 'carga.html' },
  ] },
  { tipo: 'grupo', id: 'professores', rotulo: 'Professores', itens: [
    { id: 'professores', rotulo: 'Cadastro de professores', href: 'professores.html' },
    { id: 'disponibilidade', rotulo: 'Disponibilidade docente', href: 'disponibilidade.html' },
    { id: 'atividades', rotulo: 'Atividades complementares', href: 'atividades.html' },
    { id: 'agenda', rotulo: 'Agenda docente', href: 'agenda.html' },
  ] },
  { tipo: 'grupo', id: 'academico', rotulo: 'Gestão acadêmica', itens: [
    { id: 'turmas', rotulo: 'Gestão de turmas', href: 'turmas.html' },
    { id: 'matrizes', rotulo: 'Matrizes curriculares', href: 'matrizes.html' },
    { id: 'configuracoes', rotulo: 'Configurações acadêmicas', href: 'configuracoes.html' },
  ] },
  { tipo: 'link', id: 'auditoria', rotulo: 'Auditoria', href: 'auditoria.html' },
  { tipo: 'link', id: 'historico', rotulo: 'Histórico de alterações', href: 'historico.html' },
  { tipo: 'link', id: 'relatorios', rotulo: 'Relatórios de aulas', href: 'relatorios.html' },
  { tipo: 'link', id: 'planilha', rotulo: 'Criar planilha', href: 'planilha.html' },
  { tipo: 'link', id: 'usuarios', rotulo: 'Usuários e acessos', href: 'usuarios.html' },
  { tipo: 'link', id: 'backup', rotulo: 'Backup', href: 'backup.html' },
  { tipo: 'sep' },
  { tipo: 'link', id: 'minhas', rotulo: 'Minhas aulas', href: 'minhas-aulas.html', pronto: true },
  { tipo: 'sair' },
];
const MENU_PROF = [
  { tipo: 'link', id: 'minhas', rotulo: 'Minhas aulas', href: 'minhas-aulas.html', pronto: true },
  { tipo: 'sep' },
  { tipo: 'sair' },
];

// Telas já entregues (as demais aparecem como "em breve")
const PRONTAS = new Set(['inicio', 'minhas', 'configuracoes', 'matrizes', 'turmas', 'professores', 'usuarios', 'disponibilidade', 'atividades', 'pos', 'carga', 'agenda', 'auditoria', 'planilha', 'relatorios', 'historico', 'montar', 'backup']);

// Telas largas: o menu começa recolhido (sanduíche) e abre por cima ao clicar
const RECOLHIDAS = new Set(['montar']);
const TELA_ESTREITA = '(max-width: 860px)';

function linkHtml(item, ativo, classe = '') {
  const pronto = PRONTAS.has(item.id);
  if (!pronto) return `<a class="${classe} embreve" aria-disabled="true" title="Em construção">${esc(item.rotulo)}</a>`;
  return `<a class="${classe}" href="${item.href}"${item.id === ativo ? ' aria-current="page"' : ''}>${esc(item.rotulo)}</a>`;
}

// Monta topo + menu lateral e devolve o elemento <main> da página
export function montarLayout(perfil, ativo) {
  const menu = perfil.perfil === 'adm' ? MENU_ADM : MENU_PROF;
  const abertos = JSON.parse(sessionStorage.getItem('menu-abertos') || '{}');

  const itens = menu.map((m) => {
    if (m.tipo === 'sep') return '<div class="sep" role="separator"></div>';
    if (m.tipo === 'sair') return '<button type="button" data-sair>Sair</button>';
    if (m.tipo === 'link') return linkHtml(m, ativo);
    const temAtivo = m.itens.some((i) => i.id === ativo);
    const aberto = m.id in abertos ? abertos[m.id] : temAtivo;
    return `<button type="button" class="grupo" data-grupo="${m.id}" aria-expanded="${aberto}">${esc(m.rotulo)}</button>
      <div class="sub${aberto ? '' : ' oculto'}" data-sub="${m.id}">${m.itens.map((i) => linkHtml(i, ativo)).join('')}</div>`;
  }).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <header class="topo">
      <div class="topo-esq">
        <button type="button" class="menu-botao" id="menu-botao" aria-label="Mostrar ou esconder o menu" aria-controls="menu-lateral" aria-expanded="false">&#9776;</button>
        <p class="topo-titulo">${esc(TITULO_SISTEMA)}</p>
      </div>
      <div class="topo-usuario"><span>${esc(perfil.nome)}</span><span class="topo-perfil">${perfil.perfil === 'adm' ? 'Administrador' : 'Professor'}</span></div>
    </header>
    <div class="corpo">
      <div class="menu-veu" id="menu-veu"></div>
      <nav class="lateral" id="menu-lateral" aria-label="Menu principal"><div class="menu">${itens}</div></nav>
      <main class="principal" id="principal"></main>
    </div>`);

  document.querySelectorAll('[data-grupo]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.grupo;
    const abrir = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(abrir));
    document.querySelector(`[data-sub="${id}"]`).classList.toggle('oculto', !abrir);
    const est = JSON.parse(sessionStorage.getItem('menu-abertos') || '{}');
    est[id] = abrir; sessionStorage.setItem('menu-abertos', JSON.stringify(est));
  }));
  document.querySelector('[data-sair]').addEventListener('click', sair);
  configurarSanduiche(ativo);
  return document.getElementById('principal');
}

// Menu sanduíche: nas telas largas (e no celular) o menu fica escondido e abre por cima;
// nas demais telas o botão recolhe ou mostra a lateral, e a escolha fica lembrada.
function configurarSanduiche(ativo) {
  const corpo = document.body, botao = document.getElementById('menu-botao');
  const estreita = window.matchMedia(TELA_ESTREITA);
  const forcado = () => RECOLHIDAS.has(ativo) || estreita.matches;
  const preferencia = () => { try { return localStorage.getItem('menu-recolhido') === '1'; } catch { return false; } };
  const medirTopo = () => document.documentElement.style.setProperty('--topo-alt', `${document.querySelector('.topo').offsetHeight}px`);
  window.addEventListener('resize', medirTopo);
  medirTopo();
  const aplicar = () => {
    corpo.classList.toggle('menu-recolhido', forcado() || preferencia());
    corpo.classList.remove('menu-aberto');
    botao.setAttribute('aria-expanded', String(!corpo.classList.contains('menu-recolhido')));
  };
  const fechar = () => { corpo.classList.remove('menu-aberto'); botao.setAttribute('aria-expanded', 'false'); };
  botao.addEventListener('click', () => {
    if (forcado()) {
      const abrir = !corpo.classList.contains('menu-aberto');
      corpo.classList.toggle('menu-aberto', abrir);
      botao.setAttribute('aria-expanded', String(abrir));
      return;
    }
    const recolher = !corpo.classList.contains('menu-recolhido');
    try { localStorage.setItem('menu-recolhido', recolher ? '1' : '0'); } catch { /* ignora */ }
    aplicar();
  });
  document.getElementById('menu-veu').addEventListener('click', fechar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && corpo.classList.contains('menu-aberto')) fechar(); });
  document.getElementById('menu-lateral').addEventListener('click', (e) => { if (e.target.closest('a[href]')) fechar(); });
  estreita.addEventListener('change', aplicar);
  aplicar();
}
