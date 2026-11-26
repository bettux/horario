import { iniciarPagina, listarPeriodos, preencherPeriodos, avisar, mostrarErro, abrirDialogo, confirmar } from './pagina.js?v=202611261200';
import { sb, q, rpc } from './supabase.js?v=202611261200';
import { esc, DIAS } from './util.js?v=202611261200';
import { tons } from './cores.js?v=202611261200';

// Montar horário: todas as turmas do curso, arrastar professor ou matéria até o horário.
// Cada ação grava na hora (gravar_aula / remover_aula) com as regras do banco.
const { perfil, main } = await iniciarPagina('montar');

main.innerHTML = `
  <header class="cabecalho" style="margin-bottom:12px">
    <div><h1>Montar horário</h1>
    <p class="sub">Arraste um professor (painel à direita) ou uma matéria da faixa "Faltam" até o horário da turma. Clique numa aula para editar ou remover. No tablet: toque para escolher e toque no horário para colocar.</p></div>
    <div class="barra" style="padding:0;gap:10px">
      <div class="campo" style="width:120px"><label for="per">Período</label><select id="per"></select></div>
      <div class="campo" style="width:220px"><label for="curso">Curso</label><select id="curso"></select></div>
    </div>
  </header>
  <div class="mh-acoes">
    <span id="presenca" class="mh-presenca"></span>
    <button type="button" class="btn btn-s" id="desfazer" disabled title="Desfazer a última ação (Ctrl+Z)">Desfazer</button>
    <button type="button" class="btn btn-p btn-s" id="auto">Preencher automaticamente</button>
  </div>
  <div id="proposta" class="oculto"></div>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="lixeira" class="mh-lixeira" aria-label="Soltar aqui para remover a aula">Solte aqui para remover a aula</div>
  <div class="mh">
    <div class="mh-turmas" id="turmas"><p class="carregando">Carregando…</p></div>
    <aside class="mh-painel card" aria-label="Professores">
      <input type="search" id="busca" placeholder="Buscar professor" aria-label="Buscar professor">
      <div id="profs" class="mh-profs"></div>
      <p class="muted" style="margin:0;font-size:11.5px;line-height:1.45">Arraste o nome até o horário (no tablet: toque no nome e depois no horário). Número = maior carga semanal do período (limite 40).</p>
    </aside>
  </div>`;

const $m = (s) => main.querySelector(s);
const periodos = await listarPeriodos();
let periodoId = preencherPeriodos($m('#per'), periodos);
const [cursos, matrizes, horarios, profsTodos, ambientesTodos] = await Promise.all([
  q(sb.from('cursos').select('id, nome, sigla, nivel').eq('nivel', 'graduacao').eq('ativo', true).order('nome')),
  q(sb.from('matrizes').select('id, curso_id, nome')),
  q(sb.from('horarios_graduacao').select('tipo_dia, numero, inicio, fim').order('numero')),
  q(sb.from('professores').select('id, nome, cor, ativo').order('nome')),
  q(sb.from('ambientes').select('id, nome').order('nome')),
]);
const HS = horarios.filter((h) => h.tipo_dia === 'semana'), HSAB = horarios.filter((h) => h.tipo_dia === 'sabado');
const hm = (t) => String(t || '').slice(0, 5);
const ocupaHorario = (c) => ['presencial', 'ead_sincrona'].includes(c.modalidade);
const prof = (id) => profsTodos.find((p) => p.id === id);
const pnome = (id) => prof(id)?.nome || '?';
const primeiro = (id) => pnome(id).split(' ')[0];
const sigla = (c) => c?.sigla || c?.nome || '?';

let periodo = null, cursoId = null, semanas = 20;
let turmas = [], comps = [], aulas = [], atribs = [], pico = new Map(), ambientes = ambientesTodos;
let filtro = '';
let destaque = null; // professor destacado no painel
let disps = [], posDias = new Map(); // disponibilidade e dias com pós (para apagar horários impossíveis)
let arrastando = null; // o que está sendo arrastado agora
const pilha = []; // ações para desfazer
let conjuntas = new Map(); // turma|componente -> aulas por semana com T1+T2 juntas (definido por semestre)
let proposta = []; // aulas sugeridas pelo preenchimento automático (ainda não gravadas)
let naoCoube = [];

$m('#curso').innerHTML = cursos.map((c) => `<option value="${c.id}">${esc(c.sigla ? `${c.sigla} · ${c.nome}` : c.nome)}</option>`).join('');
try { const c = new URLSearchParams(location.search).get('curso') || localStorage.getItem('montar-curso'); if (cursos.some((x) => x.id === c)) { $m('#curso').value = c; localStorage.setItem('montar-curso', c); } } catch { /* ignora */ }
cursoId = $m('#curso').value;

// ---------- dados ----------
async function carregar() {
  if (!periodoId) { $m('#turmas').innerHTML = '<p class="muted">Crie um período em Configurações acadêmicas.</p>'; return; }
  periodo = periodos.find((p) => p.id === periodoId);
  semanas = periodo.semanas_letivas || 20;
  const mats = matrizes.filter((m) => m.curso_id === cursoId).map((m) => m.id);
  const [ts, cs, au, carga] = await Promise.all([
    mats.length ? q(sb.from('turmas').select('id, matriz_id, semestre, identificacao, subturmas(id, nome)').eq('periodo_id', periodoId).gt('semestre', 0).in('matriz_id', mats)) : [],
    mats.length ? q(sb.from('componentes').select('id, matriz_id, semestre, nome, sigla, carga, modalidade, regra, professor, ordem').in('matriz_id', mats).eq('ativo', true).order('ordem')) : [],
    q(sb.from('v_aulas_horario').select('id, turma_id, componente_id, dia_semana, inicio, quantidade, ambiente_id').eq('periodo_id', periodoId)),
    rpc('carga_todos', { p_periodo: periodoId }),
  ]);
  const [ds, encs] = await Promise.all([
    q(sb.from('disponibilidades').select('professor_id, dia_semana, inicio, fim').eq('periodo_id', periodoId)),
    q(sb.from('v_encontros').select('professor_id, dia_semana').eq('periodo_id', periodoId)),
  ]);
  disps = ds;
  posDias = new Map();
  for (const e of encs) { if (!posDias.has(e.professor_id)) posDias.set(e.professor_id, new Set()); posDias.get(e.professor_id).add(e.dia_semana); }
  turmas = ts.map((t) => ({ ...t, subturmas: [...(t.subturmas || [])].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })) }))
    .sort((a, b) => a.semestre - b.semestre || a.identificacao.localeCompare(b.identificacao, 'pt-BR', { numeric: true }));
  comps = cs;
  const ids = au.map((a) => a.id), subsIds = turmas.flatMap((t) => t.subturmas.map((s) => s.id));
  const [ap, as, at, tc] = await Promise.all([
    ids.length ? q(sb.from('aula_professores').select('aula_id, professor_id').in('aula_id', ids)) : [],
    ids.length ? q(sb.from('aula_subturmas').select('aula_id, subturma_id').in('aula_id', ids)) : [],
    subsIds.length ? q(sb.from('atribuicoes').select('subturma_id, componente_id, professor_id').in('subturma_id', subsIds)) : [],
    turmas.length ? q(sb.from('turma_conjuntas').select('turma_id, componente_id, aulas').in('turma_id', turmas.map((t) => t.id))) : [],
  ]);
  aulas = au.map((a) => ({ ...a, professores: ap.filter((x) => x.aula_id === a.id).map((x) => x.professor_id), subturmas: as.filter((x) => x.aula_id === a.id).map((x) => x.subturma_id) }));
  atribs = at;
  conjuntas = new Map(tc.map((x) => [`${x.turma_id}|${x.componente_id}`, x.aulas]));
  pico = new Map();
  for (const c of carga) pico.set(c.professor_id, Math.max(pico.get(c.professor_id) || 0, Number(c.total)));
  desenhar();
}

// quanto falta por semana de uma matéria numa subturma
function alvo(c) { return c.regra === 'pi_extensao' ? 2 : Math.ceil((Number(c.carga) || 0) / semanas); }
function lancadas(t, cId, sId) { return aulas.filter((a) => a.turma_id === t.id && a.componente_id === cId && a.subturmas.includes(sId)).reduce((n, a) => n + a.quantidade, 0); }
const falta = (t, c, s) => Math.max(0, alvo(c) - lancadas(t, c.id, s.id));
// aulas conjuntas (turma inteira) definidas para a turma no semestre e quanto ainda falta delas
function conjFalta(t, c) {
  if (t.subturmas.length < 2) return 0;
  const alvoC = Math.min(conjuntas.get(`${t.id}|${c.id}`) || 0, alvo(c));
  const lanc = aulas.filter((a) => a.turma_id === t.id && a.componente_id === c.id && t.subturmas.every((s) => a.subturmas.includes(s.id))).reduce((n, a) => n + a.quantidade, 0);
  return Math.max(0, Math.min(alvoC - lanc, ...t.subturmas.map((s) => falta(t, c, s))));
}
const atribDe = (sId, cId) => atribs.find((x) => x.subturma_id === sId && x.componente_id === cId)?.professor_id || null;
const compsDaTurma = (t) => comps.filter((c) => c.matriz_id === t.matriz_id && c.semestre === t.semestre && ocupaHorario(c));

function faltam(t) {
  const chips = [];
  for (const c of compsDaTurma(t)) {
    const cj = conjFalta(t, c);
    // parte conjunta (só quando a matriz prevê): uma etiqueta da turma inteira
    if (cj > 0) chips.push({ comp: c, falta: cj, prof: atribDe(t.subturmas[0].id, c.id), subs: [...t.subturmas], conj: true });
    // o resto é separado por subturma (o normal)
    for (const s of t.subturmas) {
      const f = falta(t, c, s) - cj; if (f <= 0) continue;
      chips.push({ comp: c, falta: f, prof: atribDe(s.id, c.id), subs: [s] });
    }
  }
  return chips;
}
function completas(t) {
  const cs = compsDaTurma(t);
  return { ok: cs.filter((c) => t.subturmas.every((s) => !falta(t, c, s))).length, total: cs.length };
}

// ---------- desenho ----------
function blocoHtml(a, t, extra = '') {
  const c = comps.find((x) => x.id === a.componente_id);
  const tn = tons(prof(a.professores[0])?.cor);
  const nomes = a.professores.map(primeiro).join(' + ') || 'sem professor';
  const subsNomes = t.subturmas.filter((s) => a.subturmas.includes(s.id)).map((s) => s.nome).join('+');
  const titulo = `${c?.nome || '?'} · ${subsNomes} · ${a.professores.map(pnome).join(' + ') || 'sem professor'}${a.ambiente_id ? ' · ' + (ambientes.find((x) => x.id === a.ambiente_id)?.nome || '') : ''}`;
  return `<button type="button" class="mh-bloco${a.prop ? ' mh-prop' : ''}" draggable="true" data-aula="${a.id}" data-profs="${a.professores.join(' ')}" title="${esc(titulo)} ${a.prop ? ' · PROPOSTA, ainda não gravada' : ''} (arraste para mover)" style="${extra}background:${tn.fundo};border-color:${tn.borda};color:${tn.texto}">
    <span class="mh-sig">${esc(sigla(c))}${a.ambiente_id ? `<span class="mh-amb">${esc(ambientes.find((x) => x.id === a.ambiente_id)?.nome || '')}</span>` : ''}</span><span class="mh-sub" style="color:${tn.suave}">${esc(nomes)}</span></button>`;
}

function turmaHtml(t) {
  const cur = cursos.find((c) => c.id === cursoId);
  const subs = t.subturmas;
  const ns = Math.max(1, subs.length);
  const comp = completas(t);
  const chips = faltam(t);
  if (!subs.length) return `<section class="card mh-turma"><div class="mh-tcab"><strong>${esc(cur?.sigla || '')} ${t.semestre}º sem. · ${esc(t.identificacao)}</strong></div>
    <p class="muted" style="margin:0">Cadastre as subturmas (T1, T2) em Gestão de turmas &gt; Editar.</p></section>`;
  let g = `<div class="mh-h"></div>`;
  for (let d = 1; d <= 5; d++) g += `<div class="mh-h mh-dia" style="grid-column:span ${ns}">${DIAS[d].slice(0, 3)}</div>`;
  g += `<div class="mh-h mh-dia">Sáb</div><div class="mh-h"></div>`;
  for (let d = 1; d <= 5; d++) subs.forEach((s) => { g += `<div class="mh-h mh-subn">${esc(s.nome)}</div>`; });
  g += `<div class="mh-h mh-subn">turma</div>`;
  // células vazias (alvos de soltar)
  HS.forEach((h, r) => {
    g += `<div class="mh-hora" style="grid-row:${r + 3};grid-column:1">${hm(h.inicio)}</div>`;
    for (let d = 1; d <= 5; d++) subs.forEach((s, i) => {
      g += `<div class="mh-slot" data-turma="${t.id}" data-dia="${d}" data-slot="${h.numero}" data-sub="${s.id}" style="grid-row:${r + 3};grid-column:${2 + (d - 1) * ns + i}"></div>`;
    });
  });
  // blocos de segunda a sexta
  const daTurma = [...aulas, ...proposta].filter((x) => x.turma_id === t.id);
  for (const a of daTurma.filter((x) => x.dia_semana <= 5)) {
    const idx = subs.map((s, i) => (a.subturmas.includes(s.id) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const r0 = HS.findIndex((h) => h.numero === a.inicio);
    if (r0 < 0) continue;
    const contig = idx[idx.length - 1] - idx[0] + 1 === idx.length;
    const faixas = contig ? [[idx[0], idx.length]] : idx.map((i) => [i, 1]);
    for (const [i0, span] of faixas) g += blocoHtml(a, t, `grid-row:${r0 + 3} / span ${Math.min(a.quantidade, HS.length - r0)};grid-column:${2 + (a.dia_semana - 1) * ns + i0} / span ${span};`);
  }
  // sábado: uma coluna, com os horários do sábado
  const sab = daTurma.filter((x) => x.dia_semana === 6);
  let s6 = HSAB.map((h, r) => `<div class="mh-slot mh-slot-sab" data-turma="${t.id}" data-dia="6" data-slot="${h.numero}" data-sub="todas" style="grid-row:${r + 1}"><span>${hm(h.inicio)}</span></div>`).join('');
  for (const a of sab) {
    const r0 = HSAB.findIndex((h) => h.numero === a.inicio);
    if (r0 < 0) continue;
    const parcial = a.subturmas.length < subs.length;
    const so = parcial ? `só ${subs.filter((s) => a.subturmas.includes(s.id)).map((s) => s.nome).join('+')}` : '';
    s6 += blocoHtml(a, t, `grid-row:${r0 + 1} / span ${Math.min(a.quantidade, HSAB.length - r0)};`).replace('</button>', so ? `<span class="mh-so">${esc(so)}</span></button>` : '</button>');
  }
  g += `<div class="mh-sab" style="grid-row:3 / span ${HS.length};grid-column:${2 + 5 * ns};grid-template-rows:repeat(${HSAB.length}, 1fr)">${s6}</div>`;

  return `<section class="card mh-turma" data-turma-card="${t.id}">
    <div class="mh-tcab"><strong>${esc(cur?.sigla || '')} · ${t.semestre}º semestre · ${esc(t.identificacao)}</strong>
      <span style="display:flex;gap:8px;align-items:center">
        <span class="chip ${comp.ok === comp.total && comp.total ? 'chip-ok' : 'chip-neu'}">${comp.ok} de ${comp.total} completas</span>
        <button type="button" class="btn btn-s" data-limpar="${t.id}">Remover todas as aulas</button></span></div>
    <div class="mh-faltam"><span class="muted">Faltam:</span>${chips.length ? chips.map((ch) => {
      const tn = ch.prof ? tons(prof(ch.prof)?.cor) : null;
      const subsTxt = ch.subs.length === subs.length && subs.length > 1 ? ' (turma inteira)' : subs.length > 1 ? ` (${ch.subs.map((s) => s.nome).join('+')})` : '';
      return `<span class="mh-chip" draggable="true" data-chip-prof="${ch.prof || ''}" data-chip='${esc(JSON.stringify({ turma: t.id, comp: ch.comp.id, prof: ch.prof, subs: ch.subs.map((s) => s.id) }))}'
        title="${esc(ch.comp.nome)}${subsTxt} · ${ch.prof ? esc(pnome(ch.prof)) : 'sem professor definido'} · faltam ${ch.falta} por semana"
        style="${tn ? `background:${tn.fundo};border-color:${tn.borda};color:${tn.texto}` : ''}">${esc(sigla(ch.comp))}${esc(subsTxt)} · ${ch.prof ? esc(primeiro(ch.prof)) : ch.comp.professor === 'obrigatorio' ? '<em>sem professor</em>' : '<span class="muted">qualquer professor</span>'} · ${ch.falta}</span>`;
    }).join('') : '<span class="chip chip-ok">nada pendente</span>'}</div>
    <div class="mh-grade" style="grid-template-columns:44px repeat(${5 * ns}, minmax(0, 1fr)) minmax(70px, 0.9fr);grid-template-rows:auto auto repeat(${HS.length}, var(--mh-linha, 36px))">${g}</div>
  </section>`;
}

function desenharProfs() {
  const lista = profsTodos.filter((p) => p.ativo && (!filtro || p.nome.toLowerCase().includes(filtro)));
  $m('#profs').innerHTML = lista.map((p) => {
    const c = pico.get(p.id) || 0;
    return `<div class="mh-prof${destaque === p.id ? ' mh-prof-ativo' : ''}" draggable="true" data-prof="${p.id}" title="${esc(p.nome)} · clique para destacar as aulas dele">
      <span class="mh-dot" style="background:${tons(p.cor).borda}"></span><span class="mh-pn">${esc(p.nome)}</span>
      <span class="mh-pc${c > 40 ? ' mh-pc-alto' : c >= 36 ? ' mh-pc-medio' : ''}">${c ? `${c}/40` : '—'}</span></div>`;
  }).join('') || '<p class="muted" style="margin:0;font-size:12.5px">Nenhum professor encontrado.</p>';
  $m('#profs').querySelectorAll('[data-prof]').forEach((el) => el.addEventListener('click', () => {
    destaque = destaque === el.dataset.prof ? null : el.dataset.prof;
    desenharProfs();
    aplicarDestaque();
  }));
  $m('#profs').querySelectorAll('[data-prof]').forEach(ligarArraste);
}

function desenhar() {
  const area = $m('#turmas');
  area.innerHTML = turmas.length ? turmas.map(turmaHtml).join('')
    : '<div class="card" style="padding:20px"><p style="margin:0">Nenhuma turma deste curso no período. Crie em Gestão de turmas (ou use "Copiar de outro período").</p></div>';
  desenharProfs();
  area.querySelectorAll('[data-chip], [data-aula]').forEach(ligarArraste);
  area.querySelectorAll('.mh-slot, .mh-bloco').forEach(ligarAlvo);
  aplicarDestaque();
  if (typeof reaplicarEscolha === 'function') reaplicarEscolha();
  area.querySelectorAll('[data-limpar]').forEach((b) => b.addEventListener('click', async () => {
    const t = turmas.find((x) => x.id === b.dataset.limpar);
    const n = aulas.filter((a) => a.turma_id === t.id).length;
    if (!n) { avisar('Esta turma ainda não tem aulas no horário.', 'aviso'); return; }
    const nome = `${cursos.find((c) => c.id === cursoId)?.sigla || ''} ${t.semestre}º semestre · ${t.identificacao}`;
    if (!(await confirmar(`Remover todas as aulas?`, `Isso apaga as ${n} aula(s) da grade da turma ${nome}. A lista de professores das matérias é mantida, e o histórico guarda o que foi apagado.`, 'Remover todas', true))) return;
    const antes = aulas.filter((a) => a.turma_id === t.id).map(snapAula);
    try {
      const r = await rpc('limpar_turma', { p_turma: t.id });
      registrar(`remover todas as aulas de ${nome}`, async () => { for (const x of antes) await gravarSnap(x); });
      avisar(`${r} aula(s) removida(s) de ${nome}.`); await carregar();
    }
    catch (e) { mostrarErro($m('#msg'), e); }
  }));
  area.querySelectorAll('[data-aula]').forEach((el) => el.addEventListener('click', () => {
    if (Date.now() < semCliqueAte) return;
    if (el.dataset.aula.startsWith('p-')) { tirarDaProposta(el.dataset.aula); return; }
    const a = aulas.find((x) => x.id === el.dataset.aula);
    dialogoAula({ turma: a.turma_id, dia: a.dia_semana, slot: a.inicio }, null, a);
  }));
}

// ---------- destacar professor ----------
function aplicarDestaque() {
  const area = $m('#turmas');
  area.classList.toggle('mh-com-destaque', !!destaque);
  area.querySelectorAll('[data-aula]').forEach((el) => el.classList.toggle('mh-dest', !!destaque && el.dataset.profs.split(' ').includes(destaque)));
  area.querySelectorAll('[data-chip-prof]').forEach((el) => el.classList.toggle('mh-dest', !!destaque && el.dataset.chipProf === destaque));
  let faixa = $m('#destaque');
  if (!destaque) { faixa?.remove(); return; }
  const n = aulas.filter((a) => a.professores.includes(destaque) && turmas.some((t) => t.id === a.turma_id));
  const qtd = n.reduce((x, a) => x + a.quantidade, 0);
  const pend = [...area.querySelectorAll('[data-chip-prof]')].filter((el) => el.dataset.chipProf === destaque).length;
  if (!faixa) { faixa = document.createElement('div'); faixa.id = 'destaque'; faixa.className = 'mh-faixa-dest'; area.closest('.mh').before(faixa); }
  const tn = tons(prof(destaque)?.cor);
  faixa.style.borderColor = tn.borda; faixa.style.background = tn.fundo; faixa.style.color = tn.texto;
  faixa.innerHTML = `<span><strong>${esc(pnome(destaque))}</strong> neste curso: ${qtd} aula${qtd === 1 ? '' : 's'} por semana${pend ? ` · ${pend} matéria${pend === 1 ? '' : 's'} ainda pendente${pend === 1 ? '' : 's'}` : ''}. Maior carga no período: ${pico.get(destaque) || 0}/40.</span>
    <button type="button" class="btn btn-s" id="limpar-dest">Tirar destaque</button>`;
  faixa.querySelector('#limpar-dest').addEventListener('click', () => { destaque = null; desenharProfs(); aplicarDestaque(); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && destaque && !document.querySelector('dialog[open]')) { destaque = null; desenharProfs(); aplicarDestaque(); } });

// ---------- lançamento direto: professor com uma só matéria pendente ----------
// devolve true se lançou (ou tentou e mostrou o motivo); false para abrir a janela
async function lancarDireto(pos, profId) {
  const t = turmas.find((x) => x.id === pos.turma);
  if (!t) return false;
  const subIds = pos.sub === 'todas' ? t.subturmas.map((s) => s.id) : [pos.sub];
  const subsAlvo = t.subturmas.filter((s) => subIds.includes(s.id));
  const cands = compsDaTurma(t).filter((c) => subsAlvo.every((s) => atribDe(s.id, c.id) === profId) && subsAlvo.some((s) => falta(t, c, s) > 0));
  if (cands.length !== 1) return false;
  const c = cands[0];
  const L = pos.dia === 6 ? HSAB : HS;
  const i = L.findIndex((h) => h.numero === pos.slot);
  const livres = i < 0 ? 1 : L.length - i;
  const qtd = Math.max(1, Math.min(Math.max(...subsAlvo.map((s) => falta(t, c, s))), livres));
  const amb = aulas.find((a) => a.turma_id === t.id && a.componente_id === c.id && a.ambiente_id);
  try {
    const id = await rpc('gravar_aula', {
      p_aula: null, p_turma: t.id, p_componente: c.id, p_dia: pos.dia, p_inicio: pos.slot, p_quantidade: qtd,
      p_subturmas: subIds, p_professores: [profId], p_ambiente: amb ? ambientes.find((x) => x.id === amb.ambiente_id)?.nome || null : null,
    });
    registrar(`lançar ${c.nome}`, () => rpc('remover_aula', { p_aula: id }));
    $m('#msg').classList.add('oculto');
    avisar(`${c.nome} lançada: ${qtd} aula${qtd > 1 ? 's' : ''} com ${primeiro(profId)}. Clique na aula para ajustar.`);
  } catch (e) { mostrarErro($m('#msg'), e); }
  await carregar();
  return true;
}

// ---------- mover aula arrastando o bloco ----------
async function moverAula(id, pos) {
  const a = aulas.find((x) => x.id === id);
  if (!a) return;
  if (pos.turma !== a.turma_id) { avisar('Para levar a aula para outra turma, lance-a de novo na turma certa.', 'aviso'); return; }
  const t = turmas.find((x) => x.id === a.turma_id);
  // aula da turma inteira continua da turma inteira; aula de uma subturma vai para a subturma onde foi solta
  const subs = pos.sub === 'todas' || a.subturmas.length > 1 ? a.subturmas : [pos.sub];
  if (pos.dia === a.dia_semana && pos.slot === a.inicio && subs.join() === a.subturmas.join()) return;
  const c = comps.find((x) => x.id === a.componente_id);
  const antes = snapAula(a);
  try {
    await rpc('gravar_aula', {
      p_aula: a.id, p_turma: t.id, p_componente: a.componente_id, p_dia: pos.dia, p_inicio: pos.slot, p_quantidade: a.quantidade,
      p_subturmas: subs, p_professores: a.professores, p_ambiente: ambientes.find((x) => x.id === a.ambiente_id)?.nome || null,
    });
    $m('#msg').classList.add('oculto');
    registrar(`mover ${c?.nome || 'aula'}`, () => gravarSnap(antes, a.id));
    avisar(`${c?.nome || 'Aula'} movida para ${DIAS[pos.dia].toLowerCase()}.`);
  } catch (e) { mostrarErro($m('#msg'), e); }
  await carregar();
}

// ---------- desfazer ----------
function snapAula(a) {
  return { turma: a.turma_id, comp: a.componente_id, dia: a.dia_semana, inicio: a.inicio, qtd: a.quantidade,
    subs: [...a.subturmas], profs: [...a.professores], amb: ambientes.find((x) => x.id === a.ambiente_id)?.nome || null };
}
function gravarSnap(x, id = null) {
  return rpc('gravar_aula', { p_aula: id, p_turma: x.turma, p_componente: x.comp, p_dia: x.dia, p_inicio: x.inicio, p_quantidade: x.qtd,
    p_subturmas: x.subs, p_professores: x.profs, p_ambiente: x.amb });
}
function registrar(desc, desfazer) {
  pilha.push({ desc, desfazer });
  if (pilha.length > 30) pilha.shift();
  atualizarDesfazer();
}
function atualizarDesfazer() {
  const b = $m('#desfazer'), ult = pilha[pilha.length - 1];
  b.disabled = !ult;
  b.textContent = ult ? `Desfazer: ${ult.desc}` : 'Desfazer';
}
async function desfazer() {
  const it = pilha.pop();
  atualizarDesfazer();
  if (!it) return;
  try { await it.desfazer(); $m('#msg').classList.add('oculto'); avisar(`Desfeito: ${it.desc}.`); }
  catch (e) { mostrarErro($m('#msg'), e); }
  await carregar();
}

// ---------- remover (lixeira e janela) e segundo professor ----------
async function removerAula(id) {
  const a = aulas.find((x) => x.id === id);
  if (!a) return;
  const antes = snapAula(a), nomeC = comps.find((x) => x.id === a.componente_id)?.nome || 'aula';
  try {
    await rpc('remover_aula', { p_aula: id });
    registrar(`remover ${nomeC}`, () => gravarSnap(antes));
    avisar(`${nomeC} removida. Use Desfazer se foi sem querer.`);
  } catch (e) { mostrarErro($m('#msg'), e); }
  await carregar();
}
async function segundoProfessor(aulaId, profId) {
  const a = aulas.find((x) => x.id === aulaId);
  if (!a) return;
  if (a.professores.includes(profId)) { avisar(`${primeiro(profId)} já está nesta aula.`, 'aviso'); return; }
  if (a.professores.length >= 2) { avisar('Esta aula já tem dois professores. Clique nela para trocar.', 'aviso'); return; }
  const antes = snapAula(a), nomeC = comps.find((x) => x.id === a.componente_id)?.nome || 'aula';
  try {
    await gravarSnap({ ...antes, profs: [...a.professores, profId] }, a.id);
    registrar(`incluir ${primeiro(profId)} em ${nomeC}`, () => gravarSnap(antes, a.id));
    $m('#msg').classList.add('oculto');
    avisar(`${primeiro(profId)} agora também está em ${nomeC}.`);
  } catch (e) { mostrarErro($m('#msg'), e); }
  await carregar();
}

// ---------- horários impossíveis durante o arraste ----------
function motivoBloqueio(profs, dia, slot, ignorar, compId = null) {
  const livreDisp = ehExtensao(comps.find((c) => c.id === compId)); // Extensão: qualquer dia e horário
  const L = dia === 6 ? HSAB : HS;
  const h = L.find((x) => x.numero === slot);
  for (const p of profs) {
    const nome = primeiro(p);
    if (posDias.get(p)?.has(dia)) return `${nome} tem pós neste dia`;
    if (h && !livreDisp && !disps.some((d) => d.professor_id === p && d.dia_semana === dia && d.inicio <= h.inicio && d.fim >= h.fim)) return `${nome} não está disponível neste horário`;
    const outra = [...aulas, ...proposta].find((a) => a.id !== ignorar && a.professores.includes(p) && a.dia_semana === dia && slot >= a.inicio && slot < a.inicio + a.quantidade);
    if (outra) return `${nome} já tem aula neste horário${turmas.some((t) => t.id === outra.turma_id) ? '' : ' (em turma de outro curso)'}`;
  }
  return '';
}
function marcarBloqueios(origem) {
  let profs = [], ignorar = null, compId = null;
  if (origem.tipo === 'prof') profs = [origem.id];
  else if (origem.tipo === 'chip' && origem.prof) { profs = [origem.prof]; compId = origem.comp; }
  else if (origem.tipo === 'aula' || origem.tipo === 'prop') { const a = [...aulas, ...proposta].find((x) => x.id === origem.id); profs = a?.professores || []; ignorar = a?.id; compId = a?.componente_id; }
  if (!profs.length) return;
  $m('#turmas').querySelectorAll('.mh-slot').forEach((el) => {
    const m = motivoBloqueio(profs, Number(el.dataset.dia), Number(el.dataset.slot), ignorar, compId);
    if (m) { el.classList.add('mh-bloq'); el.dataset.motivo = m; el.title = m; }
  });
}
function limparBloqueios() {
  $m('#turmas').querySelectorAll('.mh-bloq').forEach((el) => { el.classList.remove('mh-bloq'); el.removeAttribute('title'); delete el.dataset.motivo; });
  document.querySelectorAll('.mh-alvo').forEach((el) => el.classList.remove('mh-alvo'));
}

// ---------- arrastar e soltar (mouse e toque) ----------
let semCliqueAte = 0;
function origemDe(el) {
  if (el.dataset.prof) return { tipo: 'prof', id: el.dataset.prof };
  if (el.dataset.chip) return { tipo: 'chip', ...JSON.parse(el.dataset.chip) };
  if (el.dataset.aula) return { tipo: el.dataset.aula.startsWith('p-') ? 'prop' : 'aula', id: el.dataset.aula };
  return null;
}
function comecar(origem) {
  arrastando = origem;
  document.body.classList.add('mh-arrastando-algo');
  document.body.classList.toggle('mh-arrastando-aula', origem.tipo === 'aula' || origem.tipo === 'prop');
  marcarBloqueios(origem);
}
function terminar() {
  arrastando = null;
  document.body.classList.remove('mh-arrastando-algo', 'mh-arrastando-aula');
  limparBloqueios();
  if (recarregarDepois) { recarregarDepois = false; carregar(); }
}
function aceita(alvo, origem) {
  if (!origem) return false;
  if (alvo.id === 'lixeira') return origem.tipo === 'aula' || origem.tipo === 'prop';
  if (alvo.dataset.aula) return origem.tipo === 'prof';
  return alvo.classList.contains('mh-slot');
}
function soltar(origem, alvo) {
  if (!aceita(alvo, origem)) return;
  if (origem.tipo === 'prop' || (alvo.dataset.aula || '').startsWith('p-')) { alterarProposta(origem, alvo); return; }
  if (alvo.id === 'lixeira') { removerAula(origem.id); return; }
  if (alvo.dataset.aula) { segundoProfessor(alvo.dataset.aula, origem.id); return; }
  const pos = { turma: alvo.dataset.turma, dia: Number(alvo.dataset.dia), slot: Number(alvo.dataset.slot), sub: alvo.dataset.sub };
  if (origem.tipo === 'aula') moverAula(origem.id, pos);
  else if (origem.tipo === 'prof') lancarDireto(pos, origem.id).then((ok) => { if (!ok) dialogoAula(pos, origem); });
  else dialogoAula(pos, origem);
}
function ligarAlvo(el) {
  el.addEventListener('dragover', (ev) => { if (aceita(el, arrastando)) { ev.preventDefault(); el.classList.add('mh-alvo'); } });
  el.addEventListener('dragleave', () => el.classList.remove('mh-alvo'));
  el.addEventListener('drop', (ev) => {
    ev.preventDefault(); ev.stopPropagation(); el.classList.remove('mh-alvo');
    let origem = arrastando;
    try { origem = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch { /* usa o estado */ }
    terminar();
    soltar(origem, el);
  });
}
function ligarArraste(el) {
  // mouse: arrastar nativo do navegador
  el.addEventListener('dragstart', (ev) => {
    const origem = origemDe(el);
    ev.dataTransfer.setData('text/plain', JSON.stringify(origem));
    ev.dataTransfer.effectAllowed = origem.tipo === 'aula' ? 'move' : 'copy';
    if (origem.tipo === 'aula') setTimeout(() => el.classList.add('mh-arrastando'), 0);
    comecar(origem);
  });
  el.addEventListener('dragend', () => { el.classList.remove('mh-arrastando'); if (arrastando) terminar(); });
}
ligarAlvo($m('#lixeira'));

// ---------- toque (tablet e celular): tocar para escolher, tocar para colocar ----------
// No toque não há arraste: toca no professor, na matéria do "Faltam" ou na aula, rola à vontade e toca no horário.
let ultimoToque = 0, escolhido = null;
document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' || e.pointerType === 'pen') ultimoToque = Date.now(); }, true);
const porToque = () => Date.now() - ultimoToque < 1200;
const barra = document.createElement('div');
barra.className = 'mh-toque-barra oculto'; barra.setAttribute('role', 'status');
document.body.appendChild(barra);

function descreverEscolha(o) {
  if (o.tipo === 'prof') return { titulo: pnome(o.id), dica: 'Toque no horário da turma. Para pôr como 2º professor, toque numa aula.' };
  if (o.tipo === 'chip') {
    const c = comps.find((x) => x.id === o.comp);
    return { titulo: `${sigla(c)}${o.prof ? ' · ' + primeiro(o.prof) : ''}`, dica: 'Toque no horário onde a aula começa.' };
  }
  const a = [...aulas, ...proposta].find((x) => x.id === o.id);
  return { titulo: `Movendo ${sigla(comps.find((x) => x.id === a?.componente_id))}`, dica: 'Toque no novo horário.' };
}
function escolher(o) {
  escolhido = o;
  limparBloqueios();
  marcarBloqueios(o);
  document.body.classList.add('mh-escolhendo');
  $m('#turmas').querySelectorAll('.mh-escolhido').forEach((el) => el.classList.remove('mh-escolhido'));
  document.querySelectorAll('[data-prof], [data-chip], [data-aula]').forEach((el) => {
    const x = origemDe(el);
    if (x && x.tipo === o.tipo && (x.id ? x.id === o.id : el.dataset.chip === o.chipRaw)) el.classList.add('mh-escolhido');
  });
  const d = descreverEscolha(o);
  barra.innerHTML = `<div><strong>${esc(d.titulo)}</strong><span>${esc(d.dica)}</span></div><button type="button" class="btn btn-s">Cancelar</button>`;
  barra.querySelector('button').addEventListener('click', soltarEscolha);
  barra.classList.remove('oculto');
}
function soltarEscolha() {
  escolhido = null;
  limparBloqueios();
  document.body.classList.remove('mh-escolhendo');
  document.querySelectorAll('.mh-escolhido').forEach((el) => el.classList.remove('mh-escolhido'));
  barra.classList.add('oculto');
}
// depois de redesenhar (gravou, tempo real...), mantém a escolha se ela ainda existir
function reaplicarEscolha() {
  if (!escolhido) return;
  if ((escolhido.tipo === 'aula' || escolhido.tipo === 'prop') && ![...aulas, ...proposta].some((x) => x.id === escolhido.id)) { soltarEscolha(); return; }
  escolher(escolhido);
}

function menuAula(el) {
  const id = el.dataset.aula, ehProp = id.startsWith('p-');
  const a = [...aulas, ...proposta].find((x) => x.id === id);
  if (!a) return;
  const c = comps.find((x) => x.id === a.componente_id);
  const t = turmas.find((x) => x.id === a.turma_id);
  const subs = t ? t.subturmas.filter((s) => a.subturmas.includes(s.id)).map((s) => s.nome).join('+') : '';
  const L = a.dia_semana === 6 ? HSAB : HS, h = L.find((x) => x.numero === a.inicio);
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogo mh-menu';
  dlg.innerHTML = `<div class="dialogo-form">
      <h2>${esc(c?.nome || 'Aula')}</h2>
      <p class="muted" style="margin:0;line-height:1.5">${esc(DIAS[a.dia_semana])}, ${hm(h?.inicio)} · ${a.quantidade} aula${a.quantidade > 1 ? 's' : ''}${subs ? ' · ' + esc(subs) : ''}<br>${esc(a.professores.map(pnome).join(' + ') || 'sem professor')}${a.ambiente_id ? ' · ' + esc(ambientes.find((x) => x.id === a.ambiente_id)?.nome || '') : ''}${ehProp ? '<br><strong>Proposta, ainda não gravada</strong>' : ''}</p>
      <div class="mh-menu-acoes">
        <button type="button" class="btn btn-p" data-m="mover">Mover para outro horário</button>
        ${ehProp ? '' : '<button type="button" class="btn" data-m="editar">Editar (professor, sala, quantidade)</button>'}
        <button type="button" class="btn btn-p btn-perigo" data-m="remover">${ehProp ? 'Tirar da proposta' : 'Remover aula'}</button>
        <button type="button" class="btn" data-m="fechar">Fechar</button>
      </div></div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    const m = b.dataset.m;
    dlg.close();
    if (m === 'mover') escolher({ tipo: ehProp ? 'prop' : 'aula', id });
    else if (m === 'editar') dialogoAula({ turma: a.turma_id, dia: a.dia_semana, slot: a.inicio }, null, a);
    else if (m === 'remover') ehProp ? tirarDaProposta(id) : removerAula(id);
  }));
  dlg.showModal();
}

// intercepta os toques antes dos cliques normais (que continuam valendo para o mouse)
document.addEventListener('click', (e) => {
  if (!porToque() || document.querySelector('dialog[open]')) return;
  const el = e.target.closest('#turmas [data-aula], #turmas [data-chip], #profs [data-prof], #turmas .mh-slot');
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  const o = el.classList.contains('mh-slot') ? null : origemDe(el);
  if (o && o.tipo === 'chip') o.chipRaw = el.dataset.chip;
  // tocou de novo no que já estava escolhido: cancela
  if (o && escolhido && o.tipo === escolhido.tipo && (o.id ? o.id === escolhido.id : o.chipRaw === escolhido.chipRaw)) { soltarEscolha(); return; }
  if (escolhido) {
    // professor escolhido + toque numa aula = 2º professor; aula escolhida + toque noutra aula = nada
    if (el.classList.contains('mh-slot') || (el.dataset.aula && escolhido.tipo === 'prof')) {
      if (el.classList.contains('mh-bloq')) { avisar(el.dataset.motivo || 'Horário indisponível.', 'aviso'); return; }
      const alvo = el, origem = escolhido;
      soltarEscolha();
      soltar(origem, alvo);
      return;
    }
  }
  if (!o) return; // toque num horário vazio sem nada escolhido
  if (o.tipo === 'aula' || o.tipo === 'prop') { menuAula(el); return; }
  escolher(o);
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && escolhido && !document.querySelector('dialog[open]')) soltarEscolha(); });



// ---------- tempo real e presença ----------
let canal = null, recarregarDepois = false, timerRT = null;
function mudouNoBanco() {
  clearTimeout(timerRT);
  timerRT = setTimeout(() => {
    if (arrastando || document.querySelector('dialog[open]')) { recarregarDepois = true; return; }
    carregar();
  }, 700);
}
function conectarTempoReal() {
  try {
    if (!sb.channel) return;
    if (canal) sb.removeChannel(canal);
    const eu = perfil.professor_id || perfil.nome;
    canal = sb.channel(`montar-${periodoId}-${cursoId}`, { config: { presence: { key: String(eu) } } });
    for (const tabela of ['aulas', 'aula_professores', 'aula_subturmas', 'atribuicoes']) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabela }, mudouNoBanco);
    }
    canal.on('presence', { event: 'sync' }, () => {
      const outros = Object.entries(canal.presenceState()).filter(([k]) => k !== String(eu)).map(([, v]) => v[0]?.nome).filter(Boolean);
      const curso = cursos.find((c) => c.id === cursoId)?.sigla || 'este curso';
      $m('#presenca').innerHTML = outros.length ? `<span class="mh-ponto"></span>${esc(outros.join(', '))} também ${outros.length > 1 ? 'estão' : 'está'} montando ${esc(curso)}` : '';
    });
    canal.subscribe((st) => { if (st === 'SUBSCRIBED') canal.track({ nome: perfil.nome }); });
  } catch { /* sem tempo real: a tela continua funcionando */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && recarregarDepois) { recarregarDepois = false; carregar(); } });

// ---------- preenchimento automático ----------
// Encaixa o que falta usando a lista Matéria -> Professor. Ordem: aulas conjuntas (turma inteira) primeiro,
// depois as mais difíceis de encaixar. Sempre tenta o bloco inteiro num dia; só divide quando não cabe.
const ehPI = (c) => /^\s*projeto integrador/i.test(c?.nome || '');
const ehExtensao = (c) => /^\s*(atividades de )?extens/i.test(c?.nome || '');
function gerarProposta() {
  if (!turmas.length) { avisar('Nenhuma turma neste curso e período.', 'aviso'); return; }
  const ocupadas = [...aulas]; // vai recebendo a proposta conforme encaixa
  const nova = []; naoCoube = [];
  const extra = new Map(); // aulas por semana somadas a cada professor
  const nomeT = (t) => `${cursos.find((c) => c.id === cursoId)?.sigla || ''} ${t.semestre}º · ${t.identificacao}`;

  // 1) demandas
  const dem = [];
  for (const t of turmas) {
    const subs = t.subturmas;
    if (!subs.length) continue;
    for (const c of compsDaTurma(t)) {
      const semProf = c.professor === 'sem';
      const cj = conjFalta(t, c); // aulas da turma inteira previstas na matriz (o normal é 0: tudo separado)
      const grupos = [];
      if (cj > 0) grupos.push({ subs: subs.map((s) => s.id), p: atribDe(subs[0].id, c.id), p2: subs.map((s) => atribDe(s.id, c.id)).find((x) => x && x !== atribDe(subs[0].id, c.id)) || null, f: cj, conj: true });
      for (const s of subs) {
        const f = falta(t, c, s) - cj;
        if (f > 0) grupos.push({ subs: [s.id], p: atribDe(s.id, c.id), f, conj: subs.length === 1 });
      }
      if (!grupos.length) continue;
      for (const g of grupos) {
        if (!g.p && !semProf && c.professor === 'obrigatorio') { naoCoube.push(`${nomeT(t)} · ${c.nome}: sem professor definido na lista Matéria → Professor.`); continue; }
        if (!g.p && ehPI(c)) { naoCoube.push(`${nomeT(t)} · ${c.nome}: escolha os professores arrastando (cada aula pode ter um professor diferente).`); continue; }
        const amb = aulas.find((a) => a.turma_id === t.id && a.componente_id === c.id && a.ambiente_id);
        dem.push({ t, c, subs: g.subs, profs: g.p && !semProf ? [g.p, g.p2].filter(Boolean) : [], qtd: g.f, conj: g.conj,
          dias: c.modalidade === 'ead_sincrona' || ehExtensao(c) ? [6, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5],
          amb: amb ? ambientes.find((x) => x.id === amb.ambiente_id)?.nome || null : null });
      }
    }
  }

  // 2) quais horários servem
  const L = (d) => (d === 6 ? HSAB : HS);
  const livre = (dm, d, slot) => {
    const h = L(d).find((x) => x.numero === slot);
    if (!h) return false;
    for (const p of dm.profs) {
      if (posDias.get(p)?.has(d)) return false;
      if (!ehExtensao(dm.c) && !disps.some((x) => x.professor_id === p && x.dia_semana === d && x.inicio <= h.inicio && x.fim >= h.fim)) return false;
      if (ocupadas.some((a) => a.professores.includes(p) && a.dia_semana === d && slot >= a.inicio && slot < a.inicio + a.quantidade)) return false;
    }
    return !ocupadas.some((a) => a.turma_id === dm.t.id && a.dia_semana === d && slot >= a.inicio && slot < a.inicio + a.quantidade && a.subturmas.some((s) => dm.subs.includes(s)));
  };
  const opcoes = (dm) => dm.dias.reduce((n, d) => n + L(d).filter((h) => livre(dm, d, h.numero)).length, 0);
  // conjuntas primeiro; depois as de menos opções; depois as maiores
  dem.forEach((dm) => { dm.op = opcoes(dm); });
  dem.sort((a, b) => Number(b.conj) - Number(a.conj) || a.op - b.op || b.qtd - a.qtd);

  // 3) encaixe
  const cargaOk = (dm, n) => dm.profs.every((p) => (pico.get(p) || 0) + Math.ceil(((extra.get(p) || 0) + n) * 1.2) <= 40);
  const carregaDia = (t, d) => ocupadas.filter((a) => a.turma_id === t.id && a.dia_semana === d).reduce((n, a) => n + a.quantidade, 0);
  const achar = (dm, n, evitar) => {
    const cands = [];
    for (const d of dm.dias) {
      if (evitar.has(d)) continue;
      const lista = L(d);
      for (let i = 0; i + n <= lista.length; i++) {
        if (lista.slice(i, i + n).every((h) => livre(dm, d, h.numero))) { cands.push({ d, inicio: lista[i].numero, carga: carregaDia(dm.t, d), ord: dm.dias.indexOf(d) }); break; }
      }
    }
    cands.sort((a, b) => (dm.dias[0] === 6 ? a.ord - b.ord : a.carga - b.carga || a.ord - b.ord));
    return cands[0] || null;
  };
  let seq = 0;
  for (const dm of dem) {
    let resta = dm.qtd; const usados = new Set();
    if (!cargaOk(dm, resta)) { naoCoube.push(`${nomeT(dm.t)} · ${dm.c.nome}: ${primeiro(dm.profs[0])} passaria do limite de 40.`); continue; }
    while (resta > 0) {
      let pos = null, n = resta;
      for (; n >= 1 && !pos; n--) pos = achar(dm, n, usados); // bloco inteiro primeiro; só divide se não couber
      if (!pos) break;
      n++;
      const item = { id: `p-${++seq}`, prop: true, turma_id: dm.t.id, componente_id: dm.c.id, dia_semana: pos.d, inicio: pos.inicio, quantidade: n,
        subturmas: dm.subs, professores: dm.profs, ambiente_id: null, amb: dm.amb };
      nova.push(item); ocupadas.push(item); usados.add(pos.d); resta -= n;
      for (const p of dm.profs) extra.set(p, (extra.get(p) || 0) + n);
    }
    if (resta > 0) {
      const quem = dm.profs.length ? primeiro(dm.profs[0]) : 'a turma';
      naoCoube.push(`${nomeT(dm.t)} · ${dm.c.nome}${dm.conj ? '' : ` (${dm.t.subturmas.filter((s) => dm.subs.includes(s.id)).map((s) => s.nome).join('+')})`}: faltaram ${resta} aula(s) — sem horário livre em que ${quem} esteja disponível.`);
    }
  }
  proposta = nova;
  desenharProposta();
  desenhar();
  if (!nova.length) avisar(naoCoube.length ? 'Não consegui encaixar nada. Veja os motivos no quadro da proposta.' : 'Não há nada pendente para encaixar neste curso.', naoCoube.length ? 'aviso' : 'ok');
}

function desenharProposta() {
  const box = $m('#proposta');
  if (!proposta.length && !naoCoube.length) { box.classList.add('oculto'); box.innerHTML = ''; $m('#auto').disabled = false; return; }
  const n = proposta.reduce((x, a) => x + a.quantidade, 0);
  box.className = 'mh-proposta';
  box.innerHTML = `<div class="mh-prop-cab">
      <div><strong>Proposta do preenchimento automático</strong>
      <span class="muted"> · ${n} aula(s) em ${proposta.length} bloco(s), com borda tracejada. Nada foi gravado ainda.</span></div>
      <div class="acoes">${proposta.length ? '<button type="button" class="btn btn-p btn-s" id="prop-aceitar">Aceitar e gravar</button>' : ''}<button type="button" class="btn btn-s" id="prop-descartar">Descartar</button></div></div>
    <p class="muted" style="margin:0;font-size:12.5px">Antes de aceitar você pode arrastar os blocos tracejados para outro horário, soltar na lixeira ou clicar para tirar da proposta. Depois de gravar, tudo continua editável normalmente.</p>
    ${naoCoube.length ? `<details${proposta.length ? '' : ' open'}><summary>Não coube (${naoCoube.length})</summary><ul>${naoCoube.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}`;
  $m('#auto').disabled = proposta.length > 0;
  box.querySelector('#prop-aceitar')?.addEventListener('click', aceitarProposta);
  box.querySelector('#prop-descartar').addEventListener('click', () => { proposta = []; naoCoube = []; desenharProposta(); desenhar(); });
}

function tirarDaProposta(id) {
  proposta = proposta.filter((x) => x.id !== id);
  desenharProposta(); desenhar();
}
function alterarProposta(origem, alvo) {
  const item = proposta.find((x) => x.id === origem.id);
  if (!item) {
    if (origem.tipo === 'prof') { // professor solto num bloco da proposta: vira 2º professor
      const alvoItem = proposta.find((x) => x.id === alvo.dataset.aula);
      if (alvoItem && !alvoItem.professores.includes(origem.id) && alvoItem.professores.length < 2) alvoItem.professores = [...alvoItem.professores, origem.id];
      desenhar();
    }
    return;
  }
  if (alvo.id === 'lixeira') { tirarDaProposta(item.id); return; }
  if (!alvo.classList.contains('mh-slot')) return;
  if (alvo.dataset.turma !== item.turma_id) { avisar('Na proposta, a aula só muda de lugar dentro da mesma turma.', 'aviso'); return; }
  item.dia_semana = Number(alvo.dataset.dia); item.inicio = Number(alvo.dataset.slot);
  if (alvo.dataset.sub !== 'todas' && item.subturmas.length === 1) item.subturmas = [alvo.dataset.sub];
  desenhar();
}

async function aceitarProposta() {
  const itens = [...proposta];
  const btn = $m('#prop-aceitar'); btn.disabled = true; btn.textContent = 'Gravando…';
  const gravados = [], falhas = [];
  for (const it of itens) {
    try {
      const id = await rpc('gravar_aula', { p_aula: null, p_turma: it.turma_id, p_componente: it.componente_id, p_dia: it.dia_semana, p_inicio: it.inicio,
        p_quantidade: it.quantidade, p_subturmas: it.subturmas, p_professores: it.professores, p_ambiente: it.amb });
      gravados.push(id);
    } catch (e) {
      const c = comps.find((x) => x.id === it.componente_id), t = turmas.find((x) => x.id === it.turma_id);
      falhas.push(`${t?.identificacao} · ${c?.nome} (${DIAS[it.dia_semana].slice(0, 3).toLowerCase()}): ${(e.linhas && e.linhas[0]) || e.message}`);
    }
  }
  if (gravados.length) registrar(`preenchimento automático (${gravados.length} bloco(s))`, async () => { for (const id of gravados) await rpc('remover_aula', { p_aula: id }); });
  proposta = [];
  naoCoube = falhas.length ? falhas.map((f) => `Não gravou: ${f}`).concat(naoCoube) : naoCoube;
  if (!falhas.length) naoCoube = [];
  avisar(`${gravados.length} bloco(s) gravado(s)${falhas.length ? `, ${falhas.length} recusado(s) pelas regras` : ''}. Use Desfazer para voltar tudo.`, falhas.length ? 'aviso' : 'ok');
  desenharProposta();
  await carregar();
}

// ---------- janela de lançar / editar ----------
function dialogoAula(alvoPos, origem, aula = null) {
  const t = turmas.find((x) => x.id === alvoPos.turma);
  const subs = t.subturmas;
  const cs = compsDaTurma(t);
  // valores iniciais
  let subsSel = aula ? aula.subturmas : origem?.tipo === 'chip' ? origem.subs : alvoPos.sub && alvoPos.sub !== 'todas' ? [alvoPos.sub] : subs.map((s) => s.id);
  let profId = aula ? aula.professores[0] : origem?.tipo === 'prof' ? origem.id : origem?.prof || null;
  const prof2 = aula?.professores[1] || '';
  let compId = aula ? aula.componente_id : origem?.tipo === 'chip' ? origem.comp : null;
  if (!compId && profId) {
    const minhas = cs.filter((c) => subsSel.some((s) => atribDe(s, c.id) === profId) && subsSel.some((s) => falta(t, c, subs.find((x) => x.id === s)) > 0));
    if (minhas.length === 1) compId = minhas[0].id;
  }
  const doProf = (c) => profId && subs.some((s) => atribDe(s.id, c.id) === profId);
  const faltaTxt = (c) => { const f = Math.max(...subs.filter((s) => subsSel.includes(s.id)).map((s) => falta(t, c, s)), 0); return f ? ` · faltam ${f}/sem.` : ' · completa'; };
  const opcoesComp = () => {
    const meus = cs.filter(doProf), outros = cs.filter((c) => !doProf(c));
    const op = (c) => `<option value="${c.id}"${c.id === compId ? ' selected' : ''}>${esc(c.nome)}${esc(faltaTxt(c))}</option>`;
    return `<option value="">Escolha a matéria</option>${meus.length ? `<optgroup label="Matérias de ${esc(primeiro(profId))}">${meus.map(op).join('')}</optgroup>` : ''}
      <optgroup label="${meus.length ? 'Outras matérias da turma' : 'Matérias da turma'}">${outros.map(op).join('')}</optgroup>`;
  };
  const maxSlots = (d, ini) => { const L = d === 6 ? HSAB : HS; const i = L.findIndex((h) => h.numero === ini); return i < 0 ? 1 : L.length - i; };
  const sugerirQtd = () => {
    const c = cs.find((x) => x.id === compId); if (!c) return 2;
    if (ehPI(c)) return 1; // PI: uma aula por professor, normalmente
    const f = Math.max(...subs.filter((s) => subsSel.includes(s.id)).map((s) => falta(t, c, s)), 0);
    return Math.max(1, Math.min(f || 1, maxSlots(alvoPos.dia, alvoPos.slot)));
  };
  const ambPadrao = aula ? (ambientes.find((x) => x.id === aula.ambiente_id)?.nome || '') : (() => {
    const outra = aulas.find((a) => a.turma_id === t.id && a.componente_id === compId && a.ambiente_id);
    return outra ? ambientes.find((x) => x.id === outra.ambiente_id)?.nome || '' : '';
  })();
  const todas = subs.length > 1 && subsSel.length === subs.length;
  const profOps = (sel, vazio) => `<option value="">${vazio}</option>` + profsTodos.filter((p) => p.ativo || p.id === sel).map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.nome)}</option>`).join('');

  const corpo = `
    <p class="muted" style="margin:0;font-size:13px">${esc(cursos.find((c) => c.id === cursoId)?.sigla || '')} · ${t.semestre}º semestre · ${esc(t.identificacao)}</p>
    <div class="linha-form">
      <div class="campo"><label for="a-dia">Dia</label><select id="a-dia">${[1, 2, 3, 4, 5, 6].map((d) => `<option value="${d}"${d === alvoPos.dia ? ' selected' : ''}>${DIAS[d]}</option>`).join('')}</select></div>
      <div class="campo"><label for="a-ini">Começa às</label><select id="a-ini"></select></div>
      <div class="campo"><label for="a-qtd">Aulas seguidas</label><input id="a-qtd" type="number" min="1" max="8" value="${aula ? aula.quantidade : sugerirQtd()}"></div>
    </div>
    <div class="campo"><label for="a-comp">Matéria</label><select id="a-comp" required>${opcoesComp()}</select></div>
    <div class="linha-form">
      <div class="campo"><label for="a-prof">Professor</label><select id="a-prof">${profOps(profId, 'Sem professor')}</select></div>
      <div class="campo"><label for="a-prof2">2º professor (opcional)</label><select id="a-prof2">${profOps(prof2, 'Nenhum')}</select></div>
    </div>
    <fieldset class="campo" style="border:0;padding:0;margin:0"><legend style="font-size:13px;font-weight:600;margin-bottom:6px">Para quem</legend>
      <div style="display:flex;flex-wrap:wrap;gap:14px">${subs.map((s) => `<label class="check"><input type="radio" name="a-sub" value="${s.id}"${!todas && subsSel.length === 1 && subsSel[0] === s.id ? ' checked' : ''}> ${esc(s.nome)}</label>`).join('')}
      ${subs.length > 1 ? `<label class="check"><input type="radio" name="a-sub" value="todas"${todas ? ' checked' : ''}> Turma inteira (${subs.map((s) => esc(s.nome)).join('+')})</label>` : ''}</div></fieldset>
    <div class="campo"><label for="a-amb">Ambiente</label><input id="a-amb" list="a-ambs" value="${esc(ambPadrao)}" placeholder="Ex.: Lab 07"><datalist id="a-ambs">${ambientes.map((x) => `<option value="${esc(x.nome)}">`).join('')}</datalist></div>
    <label class="check oculto" id="a-lista-box"><input type="checkbox" id="a-lista" checked> <span id="a-lista-txt"></span></label>
    ${aula ? '<div style="border-top:1px solid var(--linha);padding-top:12px"><button type="button" class="btn btn-p btn-perigo" id="a-remover">Remover esta aula</button></div>' : ''}`;

  const dlg = abrirDialogo({
    titulo: aula ? 'Editar aula' : 'Lançar aula', confirmar: aula ? 'Salvar' : 'Lançar aula', corpo,
    aoConfirmar: async (d) => {
      const comp = d.querySelector('#a-comp').value;
      if (!comp) throw new Error('Escolha a matéria.');
      const subEsc = d.querySelector('input[name="a-sub"]:checked')?.value;
      if (!subEsc) throw new Error('Escolha para qual subturma é a aula.');
      const subIds = subEsc === 'todas' ? subs.map((s) => s.id) : [subEsc];
      const p1 = d.querySelector('#a-prof').value, p2 = d.querySelector('#a-prof2').value;
      if (p2 && p2 === p1) throw new Error('O 2º professor é o mesmo do 1º.');
      const antes = aula ? snapAula(aula) : null;
      const id = await rpc('gravar_aula', {
        p_aula: aula?.id || null, p_turma: t.id, p_componente: comp,
        p_dia: Number(d.querySelector('#a-dia').value), p_inicio: Number(d.querySelector('#a-ini').value), p_quantidade: Number(d.querySelector('#a-qtd').value),
        p_subturmas: subIds, p_professores: [p1, p2].filter(Boolean), p_ambiente: d.querySelector('#a-amb').value.trim() || null,
      });
      if (p1 && !d.querySelector('#a-lista-box').classList.contains('oculto') && d.querySelector('#a-lista').checked) {
        await q(sb.from('atribuicoes').upsert(subIds.map((s) => ({ subturma_id: s, componente_id: comp, professor_id: p1 })), { onConflict: 'subturma_id,componente_id' }));
      }
      const nomeC = comps.find((x) => x.id === comp)?.nome || 'aula';
      if (aula) registrar(`editar ${nomeC}`, () => gravarSnap(antes, aula.id));
      else registrar(`lançar ${nomeC}`, () => rpc('remover_aula', { p_aula: id }));
      avisar(aula ? 'Aula atualizada.' : 'Aula lançada.');
      await carregar();
    },
  });
  dlg.style.width = 'min(620px, calc(100vw - 32px))';
  const $d = (s) => dlg.querySelector(s);
  const preencherInicio = () => {
    const d = Number($d('#a-dia').value), L = d === 6 ? HSAB : HS;
    const atual = Number($d('#a-ini').value) || alvoPos.slot;
    $d('#a-ini').innerHTML = L.map((h) => `<option value="${h.numero}"${h.numero === atual ? ' selected' : ''}>${hm(h.inicio)} (${h.numero}ª aula)</option>`).join('');
  };
  const checarLista = () => {
    const p1 = $d('#a-prof').value, comp = $d('#a-comp').value, subEsc = $d('input[name="a-sub"]:checked')?.value;
    const subIds = subEsc === 'todas' ? subs.map((s) => s.id) : subEsc ? [subEsc] : [];
    const precisa = p1 && comp && subIds.some((s) => atribDe(s, comp) !== p1);
    $d('#a-lista-box').classList.toggle('oculto', !precisa);
    if (precisa) $d('#a-lista-txt').textContent = `Salvar também na lista de professores (${primeiro(p1)} dá esta matéria nesta turma)`;
  };
  preencherInicio();
  $d('#a-dia').addEventListener('change', () => {
    preencherInicio();
    if (Number($d('#a-dia').value) === 6 && subs.length > 1) { const r = $d('input[name="a-sub"][value="todas"]'); if (r) r.checked = true; }
  });
  $d('#a-comp').addEventListener('change', () => {
    compId = $d('#a-comp').value;
    if (!aula) $d('#a-qtd').value = sugerirQtd();
    if (!$d('#a-prof').value) { const p = subsSel.map((s) => atribDe(s, compId)).find(Boolean); if (p) $d('#a-prof').value = p; }
    checarLista();
  });
  $d('#a-prof').addEventListener('change', () => { profId = $d('#a-prof').value || null; checarLista(); });
  dlg.querySelectorAll('input[name="a-sub"]').forEach((r) => r.addEventListener('change', () => {
    subsSel = r.value === 'todas' ? subs.map((s) => s.id) : [r.value];
    checarLista();
  }));
  $d('#a-remover')?.addEventListener('click', async () => {
    dlg.close();
    if (!(await confirmar('Remover aula?', 'A aula sai da grade desta turma.', 'Remover', true))) return;
    try { await removerAula(aula.id); }
    catch (e) { mostrarErro($m('#msg'), e); }
  });
  checarLista();
  dlg.addEventListener('close', () => { if (recarregarDepois) { recarregarDepois = false; carregar(); } });
  if (!compId) $d('#a-comp').focus(); else $d('[data-ok]').focus();
}

// ---------- eventos ----------
$m('#per').addEventListener('change', (e) => { periodoId = e.target.value; proposta = []; desenharProposta(); pilha.length = 0; atualizarDesfazer(); conectarTempoReal(); carregar(); });
$m('#curso').addEventListener('change', (e) => { cursoId = e.target.value; try { localStorage.setItem('montar-curso', cursoId); } catch { /* ignora */ } proposta = []; desenharProposta(); pilha.length = 0; atualizarDesfazer(); conectarTempoReal(); carregar(); });
$m('#desfazer').addEventListener('click', desfazer);
$m('#auto').addEventListener('click', gerarProposta);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !document.querySelector('dialog[open]') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    e.preventDefault(); desfazer();
  }
});
conectarTempoReal();
$m('#busca').addEventListener('input', (e) => { filtro = e.target.value.trim().toLowerCase(); desenharProfs(); });
carregar().catch((e) => mostrarErro($m('#msg'), e));
