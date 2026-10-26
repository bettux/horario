import { TITULO_SISTEMA } from './config.js';
import { sair } from './auth.js';
import { esc } from './util.js';

// Menu do administrador. "pronto: false" = tela ainda não entregue.
const MENU_ADM = [
  { tipo: 'link', id: 'inicio', rotulo: 'Dashboard', href: 'inicio.html', pronto: true },
  { tipo: 'grupo', id: 'planejamento', rotulo: 'Planejamento', itens: [
    { id: 'grade', rotulo: 'Grade da graduação', href: 'grade.html' },
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
  { tipo: 'link', id: 'relatorios', rotulo: 'Relatórios de aulas', href: 'relatorios.html' },
  { tipo: 'link', id: 'usuarios', rotulo: 'Usuários e acessos', href: 'usuarios.html' },
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
const PRONTAS = new Set(['inicio', 'minhas', 'configuracoes', 'matrizes', 'turmas', 'professores', 'usuarios']);

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
      <p class="topo-titulo">${esc(TITULO_SISTEMA)}</p>
      <div class="topo-usuario"><span>${esc(perfil.nome)}</span><span class="topo-perfil">${perfil.perfil === 'adm' ? 'Administrador' : 'Professor'}</span></div>
    </header>
    <div class="corpo">
      <nav class="lateral" aria-label="Menu principal"><div class="menu">${itens}</div></nav>
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
  return document.getElementById('principal');
}
