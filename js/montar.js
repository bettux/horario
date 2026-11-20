import { iniciarPagina, listarPeriodos, preencherPeriodos, avisar, mostrarErro, abrirDialogo, confirmar } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { esc, DIAS } from './util.js';
import { tons } from './cores.js';

// Montar horário: todas as turmas do curso, arrastar professor ou matéria até o horário.
// Cada ação grava na hora (gravar_aula / remover_aula) com as regras do banco.
const { main } = await iniciarPagina('montar');

main.innerHTML = `
  <header class="cabecalho" style="margin-bottom:12px">
    <div><h1>Montar horário</h1>
    <p class="sub">Arraste um professor (painel à direita) ou uma matéria da faixa "Faltam" até o horário da turma. Clique numa aula para editar ou remover.</p></div>
    <div class="barra" style="padding:0;gap:10px">
      <div class="campo" style="width:120px"><label for="per">Período</label><select id="per"></select></div>
      <div class="campo" style="width:220px"><label for="curso">Curso</label><select id="curso"></select></div>
    </div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <div class="mh">
    <div class="mh-turmas" id="turmas"><p class="carregando">Carregando…</p></div>
    <aside class="mh-painel card" aria-label="Professores">
      <input type="search" id="busca" placeholder="Buscar professor" aria-label="Buscar professor">
      <div id="profs" class="mh-profs"></div>
      <p class="muted" style="margin:0;font-size:11.5px;line-height:1.45">Arraste o nome até o horário. Número = maior carga semanal do período (limite 40).</p>
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

$m('#curso').innerHTML = cursos.map((c) => `<option value="${c.id}">${esc(c.sigla ? `${c.sigla} · ${c.nome}` : c.nome)}</option>`).join('');
try { const c = localStorage.getItem('montar-curso'); if (cursos.some((x) => x.id === c)) $m('#curso').value = c; } catch { /* ignora */ }
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
  turmas = ts.map((t) => ({ ...t, subturmas: [...(t.subturmas || [])].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })) }))
    .sort((a, b) => a.semestre - b.semestre || a.identificacao.localeCompare(b.identificacao, 'pt-BR', { numeric: true }));
  comps = cs;
  const ids = au.map((a) => a.id), subsIds = turmas.flatMap((t) => t.subturmas.map((s) => s.id));
  const [ap, as, at] = await Promise.all([
    ids.length ? q(sb.from('aula_professores').select('aula_id, professor_id').in('aula_id', ids)) : [],
    ids.length ? q(sb.from('aula_subturmas').select('aula_id, subturma_id').in('aula_id', ids)) : [],
    subsIds.length ? q(sb.from('atribuicoes').select('subturma_id, componente_id, professor_id').in('subturma_id', subsIds)) : [],
  ]);
  aulas = au.map((a) => ({ ...a, professores: ap.filter((x) => x.aula_id === a.id).map((x) => x.professor_id), subturmas: as.filter((x) => x.aula_id === a.id).map((x) => x.subturma_id) }));
  atribs = at;
  pico = new Map();
  for (const c of carga) pico.set(c.professor_id, Math.max(pico.get(c.professor_id) || 0, Number(c.total)));
  desenhar();
}

// quanto falta por semana de uma matéria numa subturma
function alvo(c) { return c.regra === 'pi_extensao' ? 2 : Math.ceil((Number(c.carga) || 0) / semanas); }
function lancadas(t, cId, sId) { return aulas.filter((a) => a.turma_id === t.id && a.componente_id === cId && a.subturmas.includes(sId)).reduce((n, a) => n + a.quantidade, 0); }
const falta = (t, c, s) => Math.max(0, alvo(c) - lancadas(t, c.id, s.id));
const atribDe = (sId, cId) => atribs.find((x) => x.subturma_id === sId && x.componente_id === cId)?.professor_id || null;
const compsDaTurma = (t) => comps.filter((c) => c.matriz_id === t.matriz_id && c.semestre === t.semestre && ocupaHorario(c));

function faltam(t) {
  const chips = [];
  for (const c of compsDaTurma(t)) {
    const grupos = new Map();
    for (const s of t.subturmas) {
      const f = falta(t, c, s); if (!f) continue;
      const p = atribDe(s.id, c.id);
      const k = `${f}|${p}`;
      if (!grupos.has(k)) grupos.set(k, { comp: c, falta: f, prof: p, subs: [] });
      grupos.get(k).subs.push(s);
    }
    chips.push(...grupos.values());
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
  return `<button type="button" class="mh-bloco" draggable="true" data-aula="${a.id}" data-profs="${a.professores.join(' ')}" title="${esc(titulo)} (arraste para mover)" style="${extra}background:${tn.fundo};border-color:${tn.borda};color:${tn.texto}">
    <span class="mh-sig">${esc(sigla(c))}</span><span class="mh-sub" style="color:${tn.suave}">${esc(nomes)}</span></button>`;
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
  for (const a of aulas.filter((x) => x.turma_id === t.id && x.dia_semana <= 5)) {
    const idx = subs.map((s, i) => (a.subturmas.includes(s.id) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const r0 = HS.findIndex((h) => h.numero === a.inicio);
    if (r0 < 0) continue;
    const contig = idx[idx.length - 1] - idx[0] + 1 === idx.length;
    const faixas = contig ? [[idx[0], idx.length]] : idx.map((i) => [i, 1]);
    for (const [i0, span] of faixas) g += blocoHtml(a, t, `grid-row:${r0 + 3} / span ${Math.min(a.quantidade, HS.length - r0)};grid-column:${2 + (a.dia_semana - 1) * ns + i0} / span ${span};`);
  }
  // sábado: uma coluna, com os horários do sábado
  const sab = aulas.filter((x) => x.turma_id === t.id && x.dia_semana === 6);
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
      const subsTxt = ch.subs.length === subs.length && subs.length > 1 ? '' : ` (${ch.subs.map((s) => s.nome).join('+')})`;
      return `<span class="mh-chip" draggable="true" data-chip-prof="${ch.prof || ''}" data-chip='${esc(JSON.stringify({ turma: t.id, comp: ch.comp.id, prof: ch.prof, subs: ch.subs.map((s) => s.id) }))}'
        title="${esc(ch.comp.nome)}${subsTxt} · ${ch.prof ? esc(pnome(ch.prof)) : 'sem professor definido'} · faltam ${ch.falta} por semana"
        style="${tn ? `background:${tn.fundo};border-color:${tn.borda};color:${tn.texto}` : ''}">${esc(sigla(ch.comp))}${esc(subsTxt)} · ${ch.prof ? esc(primeiro(ch.prof)) : '<em>sem professor</em>'} · ${ch.falta}</span>`;
    }).join('') : '<span class="chip chip-ok">nada pendente</span>'}</div>
    <div class="mh-grade" style="grid-template-columns:44px repeat(${5 * ns}, minmax(0, 1fr)) minmax(70px, 0.9fr);grid-template-rows:auto auto repeat(${HS.length}, 36px)">${g}</div>
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
  $m('#profs').querySelectorAll('[data-prof]').forEach((el) => el.addEventListener('dragstart', (ev) => {
    ev.dataTransfer.setData('text/plain', JSON.stringify({ tipo: 'prof', id: el.dataset.prof }));
    ev.dataTransfer.effectAllowed = 'copy';
  }));
}

function desenhar() {
  const area = $m('#turmas');
  area.innerHTML = turmas.length ? turmas.map(turmaHtml).join('')
    : '<div class="card" style="padding:20px"><p style="margin:0">Nenhuma turma deste curso no período. Crie em Gestão de turmas (ou use "Copiar de outro período").</p></div>';
  desenharProfs();
  area.querySelectorAll('[data-chip]').forEach((el) => el.addEventListener('dragstart', (ev) => {
    ev.dataTransfer.setData('text/plain', JSON.stringify({ tipo: 'chip', ...JSON.parse(el.dataset.chip) }));
    ev.dataTransfer.effectAllowed = 'copy';
  }));
  area.querySelectorAll('.mh-slot').forEach((el) => {
    el.addEventListener('dragover', (ev) => { ev.preventDefault(); el.classList.add('mh-alvo'); });
    el.addEventListener('dragleave', () => el.classList.remove('mh-alvo'));
    el.addEventListener('drop', (ev) => {
      ev.preventDefault(); el.classList.remove('mh-alvo');
      let origem; try { origem = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch { return; }
      const pos = { turma: el.dataset.turma, dia: Number(el.dataset.dia), slot: Number(el.dataset.slot), sub: el.dataset.sub };
      if (origem.tipo === 'aula') moverAula(origem.id, pos);
      else dialogoAula(pos, origem);
    });
  });
  aplicarDestaque();
  area.querySelectorAll('[data-limpar]').forEach((b) => b.addEventListener('click', async () => {
    const t = turmas.find((x) => x.id === b.dataset.limpar);
    const n = aulas.filter((a) => a.turma_id === t.id).length;
    if (!n) { avisar('Esta turma ainda não tem aulas na grade.', 'aviso'); return; }
    const nome = `${cursos.find((c) => c.id === cursoId)?.sigla || ''} ${t.semestre}º semestre · ${t.identificacao}`;
    if (!(await confirmar(`Remover todas as aulas?`, `Isso apaga as ${n} aula(s) da grade da turma ${nome}. A lista de professores das matérias é mantida, e o histórico guarda o que foi apagado.`, 'Remover todas', true))) return;
    try { const r = await rpc('limpar_turma', { p_turma: t.id }); avisar(`${r} aula(s) removida(s) de ${nome}.`); await carregar(); }
    catch (e) { mostrarErro($m('#msg'), e); }
  }));
  area.querySelectorAll('[data-aula]').forEach((el) => {
    el.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', JSON.stringify({ tipo: 'aula', id: el.dataset.aula }));
      ev.dataTransfer.effectAllowed = 'move';
      setTimeout(() => el.classList.add('mh-arrastando'), 0);
    });
    el.addEventListener('dragend', () => el.classList.remove('mh-arrastando'));
  });
  area.querySelectorAll('[data-aula]').forEach((el) => el.addEventListener('click', () => {
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
  try {
    await rpc('gravar_aula', {
      p_aula: a.id, p_turma: t.id, p_componente: a.componente_id, p_dia: pos.dia, p_inicio: pos.slot, p_quantidade: a.quantidade,
      p_subturmas: subs, p_professores: a.professores, p_ambiente: ambientes.find((x) => x.id === a.ambiente_id)?.nome || null,
    });
    $m('#msg').classList.add('oculto');
    avisar(`${c?.nome || 'Aula'} movida para ${DIAS[pos.dia].toLowerCase()}.`);
  } catch (e) { mostrarErro($m('#msg'), e); }
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
      await rpc('gravar_aula', {
        p_aula: aula?.id || null, p_turma: t.id, p_componente: comp,
        p_dia: Number(d.querySelector('#a-dia').value), p_inicio: Number(d.querySelector('#a-ini').value), p_quantidade: Number(d.querySelector('#a-qtd').value),
        p_subturmas: subIds, p_professores: [p1, p2].filter(Boolean), p_ambiente: d.querySelector('#a-amb').value.trim() || null,
      });
      if (p1 && !d.querySelector('#a-lista-box').classList.contains('oculto') && d.querySelector('#a-lista').checked) {
        await q(sb.from('atribuicoes').upsert(subIds.map((s) => ({ subturma_id: s, componente_id: comp, professor_id: p1 })), { onConflict: 'subturma_id,componente_id' }));
      }
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
    try { await rpc('remover_aula', { p_aula: aula.id }); avisar('Aula removida.'); await carregar(); }
    catch (e) { mostrarErro($m('#msg'), e); }
  });
  checarLista();
  if (!compId) $d('#a-comp').focus(); else $d('[data-ok]').focus();
}

// ---------- eventos ----------
$m('#per').addEventListener('change', (e) => { periodoId = e.target.value; carregar(); });
$m('#curso').addEventListener('change', (e) => { cursoId = e.target.value; try { localStorage.setItem('montar-curso', cursoId); } catch { /* ignora */ } carregar(); });
$m('#busca').addEventListener('input', (e) => { filtro = e.target.value.trim().toLowerCase(); desenharProfs(); });
carregar().catch((e) => mostrarErro($m('#msg'), e));
