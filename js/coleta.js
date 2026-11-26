import { iniciarPagina, listarPeriodos, preencherPeriodos, periodoRotulo, avisar, abrirDialogo, mostrarErro } from './pagina.js?v=202611261217';
import { sb, q } from './supabase.js?v=202611261217';
import { esc, DIAS, parseData, ddmmaaaa } from './util.js?v=202611261217';

// Coleta dos professores (ADM): abre/fecha a coleta do período, acompanha quem enviou
// e mostra quem domina cada matéria. O ADM também pode alterar o que o professor marcou.
const { main } = await iniciarPagina('coleta');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Coleta dos professores</h1>
    <p class="sub">Os professores informam a disponibilidade do período e as matérias que dominam em "Meu planejamento". As matérias ficam guardadas de um semestre para o outro.</p></div>
    <div class="campo" style="width:150px"><label for="per">Período</label><select id="per"></select></div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="conteudo"><p class="carregando">Carregando…</p></div>`;

const $c = (s) => main.querySelector(s);
const periodos = await listarPeriodos();
let periodoId = preencherPeriodos($c('#per'), periodos);
$c('#per').addEventListener('change', (e) => { periodoId = e.target.value; carregar(); });

const [cursos, matrizes, profs] = await Promise.all([
  q(sb.from('cursos').select('id, nome, sigla, nivel, ativo').eq('ativo', true).order('nivel').order('nome')),
  q(sb.from('matrizes').select('id, curso_id, vigente').eq('vigente', true)),
  q(sb.from('professores').select('id, nome, cor, ativo').eq('ativo', true).order('nome')),
]);
const comps = (await q(sb.from('componentes').select('id, matriz_id, semestre, ordem, nome, modalidade, professor').eq('ativo', true).in('matriz_id', matrizes.map((m) => m.id)).neq('professor', 'sem').order('semestre').order('ordem')))
  .map((k) => ({ ...k, curso_id: matrizes.find((m) => m.id === k.matriz_id)?.curso_id }));
const cursosComMat = cursos.filter((c) => comps.some((k) => k.curso_id === c.id));
const primeiro = (n) => String(n || '').split(' ')[0];
let aba = 'prof', cursoSel = cursosComMat[0]?.id || null;
let envios = [], disps = [], compet = [];

async function carregar() {
  if (!periodoId) { $c('#conteudo').innerHTML = '<p class="muted">Crie um período em Configurações acadêmicas.</p>'; return; }
  try {
    [envios, disps, compet] = await Promise.all([
      q(sb.from('coleta_envios').select('professor_id, enviado_em').eq('periodo_id', periodoId)),
      q(sb.from('disponibilidades').select('professor_id, dia_semana, inicio, fim').eq('periodo_id', periodoId)),
      q(sb.from('competencias').select('professor_id, componente_id, nivel, atualizado_por')),
    ]);
  } catch (e) { mostrarErro($c('#msg'), e); return; }
  desenhar();
}

function desenhar() {
  const p = periodos.find((x) => x.id === periodoId);
  const hoje = new Date().toISOString().slice(0, 10);
  const vencida = p.coleta_aberta && p.coleta_prazo && p.coleta_prazo < hoje;
  const enviados = profs.filter((x) => envios.some((e) => e.professor_id === x.id)).length;
  const pct = profs.length ? Math.round((enviados / profs.length) * 100) : 0;
  $c('#conteudo').innerHTML = `
    <section class="card painel cl-topo">
      <div class="cl-estado">
        <div><span class="rotulo">Coleta ${periodoRotulo(p)}</span>
          <strong>${p.coleta_aberta ? (vencida ? 'Prazo encerrado (só consulta para o professor)' : 'Aberta') : 'Fechada'}</strong></div>
        <div class="campo" style="width:170px"><label for="prazo">Prazo para os professores</label><input id="prazo" type="date" value="${p.coleta_prazo || ''}"></div>
        <div class="cl-botoes">
          ${p.coleta_aberta
            ? '<button type="button" class="btn btn-s" id="salvar-prazo">Salvar prazo</button><button type="button" class="btn btn-s" id="fechar">Encerrar coleta</button>'
            : '<button type="button" class="btn btn-p" id="abrir">Abrir coleta</button>'}
        </div>
      </div>
      <div class="cl-prog"><div class="cl-barra"><span style="width:${pct}%"></span></div>
        <span><strong>${enviados}</strong> de ${profs.length} professores enviaram</span></div>
      <p class="muted" style="margin:0;font-size:12.5px;line-height:1.5">Com a coleta aberta, cada professor vê um aviso em "Minhas aulas" e preenche em "Meu planejamento", mesmo que o período ainda esteja oculto para consulta. Depois do prazo, ele só consegue ver. Você continua podendo mudar tudo aqui e em Disponibilidade docente.</p>
    </section>
    <div class="abas" role="tablist">
      <button class="aba" role="tab" data-aba="prof" aria-selected="${aba === 'prof'}">Professores</button>
      <button class="aba" role="tab" data-aba="mat" aria-selected="${aba === 'mat'}">Matérias</button>
    </div>
    <div id="aba"></div>`;
  $c('#conteudo').querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => { aba = b.dataset.aba; desenhar(); }));
  const atualizar = async (dados, texto) => {
    try { await q(sb.from('periodos').update(dados).eq('id', p.id)); Object.assign(p, dados); avisar(texto); desenhar(); }
    catch (e) { mostrarErro($c('#msg'), e); }
  };
  $c('#abrir')?.addEventListener('click', () => atualizar({ coleta_aberta: true, coleta_prazo: $c('#prazo').value || null }, 'Coleta aberta. Os professores já veem o aviso.'));
  $c('#salvar-prazo')?.addEventListener('click', () => atualizar({ coleta_prazo: $c('#prazo').value || null }, 'Prazo salvo.'));
  $c('#fechar')?.addEventListener('click', () => atualizar({ coleta_aberta: false }, 'Coleta encerrada. O que os professores enviaram continua guardado.'));
  if (aba === 'prof') abaProfessores(); else abaMaterias();
}

const hm = (t) => String(t || '').slice(0, 5);
function abaProfessores() {
  const linhas = profs.map((x) => {
    const env = envios.find((e) => e.professor_id === x.id);
    const ds = disps.filter((d) => d.professor_id === x.id).sort((a, b) => a.dia_semana - b.dia_semana);
    const cs = compet.filter((c) => c.professor_id === x.id);
    return `<tr>
      <td><span class="mh-dot" style="background:${esc(x.cor)};display:inline-block;margin-right:6px"></span>${esc(x.nome)}</td>
      <td>${env ? `<span class="chip chip-ok">Enviou ${new Date(env.enviado_em).toLocaleDateString('pt-BR')}</span>` : '<span class="chip chip-neu">Não enviou</span>'}</td>
      <td style="font-size:13px">${ds.length ? ds.map((d) => `<span title="${hm(d.inicio)}–${hm(d.fim)}">${DIAS[d.dia_semana].slice(0, 3)}</span>`).join(' · ') : '<span class="muted">—</span>'}</td>
      <td class="num">${cs.filter((c) => c.nivel === 'domino').length}</td>
      <td class="num">${cs.filter((c) => c.nivel === 'conheco').length}</td>
      <td><div class="acoes"><button class="btn btn-s" data-mat="${x.id}">Matérias</button><a class="btn btn-s" href="disponibilidade.html" data-disp="${x.id}">Disponibilidade</a></div></td></tr>`;
  }).join('');
  $c('#aba').innerHTML = `<section class="card tabela-box"><table>
    <thead><tr><th>Professor</th><th>Situação</th><th>Dias disponíveis</th><th class="num">Domina</th><th class="num">Conhece</th><th></th></tr></thead>
    <tbody>${linhas || '<tr><td colspan="6" class="muted">Nenhum professor ativo.</td></tr>'}</tbody></table></section>`;
  $c('#aba').querySelectorAll('[data-mat]').forEach((b) => b.addEventListener('click', () => editarMaterias(profs.find((x) => x.id === b.dataset.mat))));
  $c('#aba').querySelectorAll('[data-disp]').forEach((a) => a.addEventListener('click', () => { try { sessionStorage.setItem('disp-prof', a.dataset.disp); } catch { /* ignora */ } }));
}

function abaMaterias() {
  const nomes = (cid, nivel) => compet.filter((c) => c.componente_id === cid && c.nivel === nivel).map((c) => profs.find((x) => x.id === c.professor_id)).filter(Boolean);
  const ks = comps.filter((k) => k.curso_id === cursoSel);
  const grupos = new Map();
  for (const k of ks) { const g = k.semestre ? `${k.semestre}º semestre` : 'Módulos'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(k); }
  const semNinguem = ks.filter((k) => !nomes(k.id, 'domino').length && !nomes(k.id, 'conheco').length).length;
  const pessoas = (lista) => lista.length ? lista.map((x) => `<span class="cl-pessoa" style="border-color:${esc(x.cor)}">${esc(x.nome)}</span>`).join('') : '<span class="muted">—</span>';
  $c('#aba').innerHTML = `
    <section class="card barra">
      <div class="campo" style="flex:0 1 340px"><label for="cl-curso">Curso</label><select id="cl-curso">${cursosComMat.map((c) => `<option value="${c.id}"${c.id === cursoSel ? ' selected' : ''}>${esc(c.sigla ? `${c.sigla} · ${c.nome}` : c.nome)}</option>`).join('')}</select></div>
      <span class="muted" style="align-self:flex-end;padding-bottom:8px">${semNinguem ? `<strong style="color:var(--aviso-chip)">${semNinguem} matéria(s)</strong> sem ninguém que domine ou conheça` : 'Todas as matérias têm ao menos um professor.'}</span>
    </section>
    <section class="card tabela-box"><table>
      <thead><tr><th>Matéria</th><th>★ Domina</th><th>☆ Conhece</th></tr></thead>
      <tbody>${[...grupos].map(([g, lista]) => `<tr class="cl-grupo"><td colspan="3">${esc(g)}</td></tr>${lista.map((k) => {
        const d = nomes(k.id, 'domino'), c = nomes(k.id, 'conheco');
        return `<tr${!d.length ? ' class="cl-alerta"' : ''}><td>${esc(k.nome)}${!d.length && !c.length ? ' <span class="chip chip-aviso">ninguém</span>' : !d.length ? ' <span class="chip chip-neu">ninguém domina</span>' : ''}</td><td>${pessoas(d)}</td><td>${pessoas(c)}</td></tr>`;
      }).join('')}`).join('') || '<tr><td colspan="3" class="muted">Nenhuma matéria.</td></tr>'}</tbody></table></section>`;
  $c('#cl-curso').addEventListener('change', (e) => { cursoSel = e.target.value; abaMaterias(); });
}

// ADM altera as matérias de um professor (mesma escala do professor)
function editarMaterias(prof) {
  let cur = cursoSel;
  const nivel = (cid) => compet.find((c) => c.professor_id === prof.id && c.componente_id === cid)?.nivel || 'sem_interesse';
  const desenharLista = (dlg) => {
    const ks = comps.filter((k) => k.curso_id === cur);
    dlg.querySelector('#ed-lista').innerHTML = ks.map((k) => {
      const n = nivel(k.id);
      return `<div class="mp-mat"><span class="mp-nome">${k.semestre ? `<span class="muted">${k.semestre}º</span> ` : ''}${esc(k.nome)}</span>
        <div class="seg mp-niveis">${[['domino', 'Domino'], ['conheco', 'Conheço'], ['sem_interesse', 'Sem interesse']].map(([v, r]) => `<button type="button" class="sb mp-${v}${v === n ? ' sb-on' : ''}" data-comp="${k.id}" data-nivel="${v}">${r}</button>`).join('')}</div></div>`;
    }).join('') || '<p class="muted">Nenhuma matéria.</p>';
    dlg.querySelectorAll('[data-nivel]').forEach((b) => b.addEventListener('click', async () => {
      const cid = b.dataset.comp, novo = b.dataset.nivel;
      try {
        if (novo === 'sem_interesse') await q(sb.from('competencias').delete().eq('professor_id', prof.id).eq('componente_id', cid));
        else await q(sb.from('competencias').upsert({ professor_id: prof.id, componente_id: cid, nivel: novo, atualizado_em: new Date().toISOString(), atualizado_por: 'coordenação' }));
        compet = compet.filter((c) => !(c.professor_id === prof.id && c.componente_id === cid));
        if (novo !== 'sem_interesse') compet.push({ professor_id: prof.id, componente_id: cid, nivel: novo, atualizado_por: 'coordenação' });
        desenharLista(dlg);
      } catch (e) { avisar(e.message, 'erro'); }
    }));
  };
  const dlg = abrirDialogo({
    titulo: `Matérias de ${primeiro(prof.nome)}`, confirmar: 'Concluir',
    corpo: `<div class="campo"><label for="ed-curso">Curso</label><select id="ed-curso">${cursosComMat.map((c) => `<option value="${c.id}"${c.id === cur ? ' selected' : ''}>${esc(c.sigla ? `${c.sigla} · ${c.nome}` : c.nome)}</option>`).join('')}</select></div>
      <p class="muted" style="margin:0;font-size:12.5px">Cada clique já fica salvo.</p>
      <div id="ed-lista" class="cl-ed-lista"></div>`,
    aoConfirmar: () => { desenhar(); },
  });
  dlg.classList.add('cl-dlg');
  dlg.querySelector('#ed-curso').addEventListener('change', (e) => { cur = e.target.value; desenharLista(dlg); });
  dlg.addEventListener('close', () => desenhar());
  desenharLista(dlg);
}

carregar();
