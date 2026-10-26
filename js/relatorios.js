import { iniciarPagina, listarPeriodos, preencherPeriodos, periodoRotulo, mostrarErro } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { esc, DIAS, parseData, ddmmaaaa, duracao } from './util.js';

// Relatórios de aulas por professor e por turma, prontos para imprimir ou salvar em PDF (A4 paisagem)
const { main } = await iniciarPagina('relatorios');

main.innerHTML = `
  <header class="cabecalho so-tela">
    <div><h1>Relatórios de aulas</h1>
    <p class="sub">Horário por professor ou por turma. Use "Imprimir / salvar PDF" e escolha "Salvar como PDF" na janela de impressão.</p></div>
  </header>
  <section class="card barra so-tela" style="margin-bottom:20px">
    <div class="campo" style="flex:0 1 140px"><label for="per">Período letivo</label><select id="per"></select></div>
    <div class="campo" style="flex:0 1 170px"><label for="tipo">Relatório</label>
      <select id="tipo"><option value="prof">Por professor</option><option value="turma">Por turma</option></select></div>
    <div class="campo" style="flex:1 1 280px"><label for="alvo">Escolha</label><select id="alvo"></select></div>
    <button class="btn btn-p" type="button" id="imprimir">Imprimir / salvar PDF</button>
  </section>
  <div id="msg" class="oculto so-tela" role="alert"></div>
  <div id="relatorio"><p class="carregando">Carregando…</p></div>`;

const $m = (s) => main.querySelector(s);
const periodos = await listarPeriodos();
let periodoId = preencherPeriodos($m('#per'), periodos);
let base = null; // dados do período

const num = (v) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const hm = (t) => String(t || '').slice(0, 5);
const dataBr = (iso) => ddmmaaaa(parseData(iso));
const diaDaData = (iso) => DIAS[((parseData(iso).getDay() + 6) % 7) + 1];

async function carregarBase() {
  const periodo = periodos.find((p) => p.id === periodoId);
  const turmas = await q(sb.from('turmas').select('id, matriz_id, semestre, identificacao, subturmas(id, nome)').eq('periodo_id', periodoId));
  const [cursos, matrizes, comps, aulas, encontros, ofertas, horarios, profs, atividades, carga, ambientes] = await Promise.all([
    q(sb.from('cursos').select('id, nome, sigla, nivel')),
    q(sb.from('matrizes').select('id, curso_id, nome')),
    q(sb.from('componentes').select('id, nome, sigla, carga')),
    q(sb.from('v_aulas_horario').select('*').eq('periodo_id', periodoId)),
    q(sb.from('v_encontros').select('*').eq('periodo_id', periodoId)),
    turmas.length ? q(sb.from('ofertas_pos').select('id, turma_id, componente_id, professor_id, modo, formato').in('turma_id', turmas.map((t) => t.id))) : [],
    q(sb.from('horarios_graduacao').select('tipo_dia, numero, inicio, fim').order('numero')),
    q(sb.from('professores').select('id, nome, nif, ativo').order('nome')),
    q(sb.from('atividades').select('professor_id, descricao, quantidade, frequencia').eq('periodo_id', periodoId)),
    rpc('carga_todos', { p_periodo: periodoId }),
    q(sb.from('ambientes').select('id, nome')),
  ]);
  const ids = aulas.map((a) => a.id);
  const [ap, as] = await Promise.all([
    ids.length ? q(sb.from('aula_professores').select('aula_id, professor_id').in('aula_id', ids)) : [],
    ids.length ? q(sb.from('aula_subturmas').select('aula_id, subturma_id').in('aula_id', ids)) : [],
  ]);
  const mapa = (l) => new Map(l.map((x) => [x.id, x]));
  const mCursos = mapa(cursos), mMat = mapa(matrizes), mComp = mapa(comps), mProf = mapa(profs), mAmb = new Map(ambientes.map((a) => [a.id, a.nome]));
  const mTurma = new Map(turmas.map((t) => {
    const c = mCursos.get(mMat.get(t.matriz_id)?.curso_id) || { sigla: '?', nome: '?', nivel: 'graduacao' };
    const pos = c.nivel === 'pos';
    return [t.id, { ...t, curso: c, pos, subturmas: [...(t.subturmas || [])].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })),
      rotulo: pos ? `${c.sigla} · ${t.identificacao}` : `${c.sigla} · ${t.semestre}º sem. · ${t.identificacao}` }];
  }));
  const listaAulas = aulas.map((a) => ({
    ...a, turma: mTurma.get(a.turma_id), comp: mComp.get(a.componente_id), ambiente: mAmb.get(a.ambiente_id) || '',
    profs: ap.filter((x) => x.aula_id === a.id).map((x) => mProf.get(x.professor_id)).filter(Boolean),
    subs: as.filter((x) => x.aula_id === a.id).map((x) => x.subturma_id),
  }));
  const listaOfertas = ofertas.map((o) => ({
    ...o, turma: mTurma.get(o.turma_id), comp: mComp.get(o.componente_id), prof: mProf.get(o.professor_id),
    encontros: encontros.filter((e) => e.oferta_id === o.id).sort((a, b) => a.data.localeCompare(b.data)).map((e) => ({ ...e, ambiente: mAmb.get(e.ambiente_id) || '' })),
  })).filter((o) => o.encontros.length);
  base = { periodo, turmas: [...mTurma.values()], aulas: listaAulas, ofertas: listaOfertas, horarios, profs, atividades, carga };
}

// ---------- opções do seletor ----------
function preencherAlvos() {
  const tipo = $m('#tipo').value, sel = $m('#alvo');
  const anterior = sel.value;
  if (tipo === 'prof') {
    const comAula = new Set([...base.aulas.flatMap((a) => a.profs.map((p) => p.id)), ...base.ofertas.map((o) => o.professor_id)]);
    const lista = base.profs.filter((p) => comAula.has(p.id));
    sel.innerHTML = `<option value="todos">Todos com aulas no período (${lista.length})</option>`
      + lista.map((p) => `<option value="${p.id}">${esc(p.nome)} · NIF ${esc(p.nif)}</option>`).join('');
  } else {
    const ts = [...base.turmas].sort((a, b) => Number(a.pos) - Number(b.pos) || a.rotulo.localeCompare(b.rotulo, 'pt-BR', { numeric: true }));
    sel.innerHTML = `<option value="todos">Todas as turmas (${ts.length})</option>`
      + ts.map((t) => `<option value="${t.id}">${esc(t.pos ? 'Pós · ' : '')}${esc(t.rotulo)}</option>`).join('');
  }
  if ([...sel.options].some((o) => o.value === anterior)) sel.value = anterior;
}

// ---------- grade semanal ----------
// celulas(dia, numero, tipo_dia) devolve a lista de HTML dos itens daquele horário
function htmlGrade(aulas, celula) {
  const sem = base.horarios.filter((h) => h.tipo_dia === 'semana');
  const sab = base.horarios.filter((h) => h.tipo_dia === 'sabado');
  const usaSab = aulas.some((a) => a.dia_semana === 6);
  const linhas = sem.map((h) => `<tr><th class="h">${hm(h.inicio)} – ${hm(h.fim)}</th>${[1, 2, 3, 4, 5].map((d) => {
    const itens = celula(aulas.filter((a) => a.dia_semana === d && a.inicio <= h.numero && h.numero < a.inicio + a.quantidade));
    return itens ? `<td>${itens}</td>` : '<td class="vazio"></td>';
  }).join('')}</tr>`).join('');
  const grade = `<table class="rel-grade"><thead><tr><th class="h">Horário</th>${[1, 2, 3, 4, 5].map((d) => `<th>${DIAS[d]}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table>`;
  if (!usaSab) return grade;
  const sabUsados = sab.filter((h) => aulas.some((a) => a.dia_semana === 6 && a.inicio <= h.numero && h.numero < a.inicio + a.quantidade));
  const linhasSab = sabUsados.map((h) => `<tr><th class="h">${hm(h.inicio)} – ${hm(h.fim)}</th><td>${celula(aulas.filter((a) => a.dia_semana === 6 && a.inicio <= h.numero && h.numero < a.inicio + a.quantidade))}</td></tr>`).join('');
  return `${grade}<h3>Sábado</h3><table class="rel-grade" style="max-width:520px"><tbody>${linhasSab}</tbody></table>`;
}

const nomesSubs = (a) => {
  const t = a.turma; if (!t?.subturmas.length) return '';
  const subs = a.subs.length ? t.subturmas.filter((s) => a.subs.includes(s.id)) : t.subturmas;
  return subs.length === t.subturmas.length && subs.length > 1 ? 'turma inteira' : subs.map((s) => s.nome).join(' + ');
};

function cabecalho(titulo, sub) {
  return `<div class="rel-cab"><div><h2>${esc(titulo)}</h2><div class="rel-sub">${sub}</div></div>
    <div class="rel-inst">Escola SENAI Vila Mariana<br>Período letivo ${esc(periodoRotulo(base.periodo))} · ${dataBr(base.periodo.inicio)} a ${dataBr(base.periodo.fim)}</div></div>`;
}
const rodape = () => `<div class="rel-rodape"><span>Sistema de alocação de aula Graduação e Pós Graduação - Vila Mariana</span><span>Emitido em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span></div>`;

function tabelaEncontros(ofertas, { comProfessor = false, comTurma = true } = {}) {
  if (!ofertas.length) return '';
  return `<table class="rel-tab"><thead><tr>${comTurma ? '<th>Turma</th>' : ''}<th>Módulo</th>${comProfessor ? '<th>Professor</th>' : ''}<th>Dias</th><th>Horário</th><th>Início</th><th>Fim</th><th style="text-align:right">Encontros</th><th>Ambiente</th><th>Datas</th></tr></thead><tbody>
    ${ofertas.map((o) => {
      const e = o.encontros, dias = [...new Set(e.map((x) => diaDaData(x.data)))].join(', ');
      const ambs = [...new Set(e.map((x) => x.ambiente).filter(Boolean))].join(', ') || '—';
      return `<tr>${comTurma ? `<td>${esc(o.turma?.rotulo)}</td>` : ''}<td><strong>${esc(o.comp?.nome)}</strong></td>${comProfessor ? `<td>${esc(o.prof?.nome || '—')}</td>` : ''}
        <td>${esc(dias)}</td><td class="num">${hm(e[0].inicio)} – ${hm(e[0].fim)}</td><td class="num">${dataBr(e[0].data)}</td><td class="num">${dataBr(e[e.length - 1].data)}</td>
        <td class="num" style="text-align:right">${e.length} · ${duracao(e.reduce((n, x) => n + x.minutos, 0))}</td><td>${esc(ambs)}</td>
        <td style="font-size:10.5px;color:var(--texto-2)">${e.map((x) => dataBr(x.data).slice(0, 5)).join(' · ')}</td></tr>`;
    }).join('')}</tbody></table>`;
}

// ---------- relatório por professor ----------
function relProfessor(p) {
  const aulas = base.aulas.filter((a) => a.profs.some((x) => x.id === p.id));
  const ofertas = base.ofertas.filter((o) => o.professor_id === p.id).sort((a, b) => a.encontros[0].data.localeCompare(b.encontros[0].data));
  const semanas = base.carga.filter((c) => c.professor_id === p.id);
  const pico = semanas.reduce((m, c) => (Number(c.total) > Number(m?.total ?? -1) ? c : m), null);
  const grad = aulas.reduce((n, a) => n + a.quantidade, 0);
  const ativ = base.atividades.filter((a) => a.professor_id === p.id);
  const celula = (l) => l.map((a) => {
    const outros = a.profs.filter((x) => x.id !== p.id).map((x) => x.nome.split(' ')[0]);
    return `<div class="rel-aula"><strong>${esc(a.comp?.nome)}</strong><span>${esc(a.turma?.rotulo)}${nomesSubs(a) ? ' · ' + esc(nomesSubs(a)) : ''}</span>
      ${a.ambiente ? `<span>${esc(a.ambiente)}</span>` : ''}${outros.length ? `<span>Com: ${esc(outros.join(', '))}</span>` : ''}</div>`;
  }).join('');
  return `<article class="rel">
    ${cabecalho(p.nome, `NIF ${esc(p.nif)} · Relatório de aulas do professor`)}
    <div class="rel-resumo">
      <span>Graduação: <b>${grad}</b> aula${grad === 1 ? '' : 's'} por semana</span>
      <span>Módulos de pós: <b>${ofertas.length}</b></span>
      ${pico ? `<span>Maior carga semanal: <b>${num(pico.total)}</b> de 40 (semana ${pico.semana})</span>` : ''}
      ${ativ.length ? `<span>Atividades: ${ativ.map((a) => `${esc(a.descricao)} (${num(a.quantidade)}${a.frequencia === 'semanal' ? '/sem.' : ' no período'})`).join(', ')}</span>` : ''}
    </div>
    ${aulas.length ? `<h3>Graduação · horário semanal</h3>${htmlGrade(aulas, celula)}` : '<p class="muted" style="margin:0;font-size:12.5px">Sem aulas de graduação no período.</p>'}
    ${ofertas.length ? `<h3>Pós-graduação · encontros</h3>${tabelaEncontros(ofertas)}<p class="muted" style="margin:0;font-size:11px">Nos dias de pós o professor fica bloqueado para a graduação.</p>` : ''}
    ${rodape()}
  </article>`;
}

// ---------- relatório por turma ----------
function relTurma(t) {
  if (t.pos) {
    const ofertas = base.ofertas.filter((o) => o.turma_id === t.id).sort((a, b) => a.encontros[0].data.localeCompare(b.encontros[0].data));
    return `<article class="rel">
      ${cabecalho(t.rotulo, `${esc(t.curso.nome)} · Relatório de aulas da turma de pós`)}
      ${ofertas.length ? tabelaEncontros(ofertas, { comProfessor: true, comTurma: false }) : '<p class="muted" style="margin:0">Nenhum módulo planejado nesta turma.</p>'}
      ${rodape()}
    </article>`;
  }
  const aulas = base.aulas.filter((a) => a.turma_id === t.id);
  const celula = (l) => l.map((a) => `<div class="rel-aula"><strong>${esc(a.comp?.nome)}</strong>
    ${nomesSubs(a) ? `<span>${esc(nomesSubs(a))}</span>` : ''}<span>${esc(a.profs.map((x) => x.nome).join(' + ') || 'Sem professor')}</span>${a.ambiente ? `<span>${esc(a.ambiente)}</span>` : ''}</div>`).join('');
  // resumo por componente
  const porComp = new Map();
  for (const a of aulas) {
    const k = a.componente_id;
    if (!porComp.has(k)) porComp.set(k, { comp: a.comp, q: 0, profs: new Set() });
    const r = porComp.get(k); r.q += a.quantidade; a.profs.forEach((x) => r.profs.add(x.nome));
  }
  const resumo = [...porComp.values()].sort((a, b) => (a.comp?.nome || '').localeCompare(b.comp?.nome || '', 'pt-BR'));
  return `<article class="rel">
    ${cabecalho(t.rotulo, `${esc(t.curso.nome)}${t.subturmas.length ? ' · subturmas ' + esc(t.subturmas.map((s) => s.nome).join(', ')) : ''} · Relatório de aulas da turma`)}
    ${aulas.length ? htmlGrade(aulas, celula) : '<p class="muted" style="margin:0">Nenhuma aula lançada nesta turma.</p>'}
    ${resumo.length ? `<h3>Componentes</h3><table class="rel-tab"><thead><tr><th>Componente</th><th style="text-align:right">Aulas por semana (somando subturmas)</th><th>Professores</th></tr></thead><tbody>
      ${resumo.map((r) => `<tr><td>${esc(r.comp?.nome)}</td><td class="num" style="text-align:right">${r.q}</td><td>${esc([...r.profs].join(', ') || '—')}</td></tr>`).join('')}</tbody></table>` : ''}
    ${rodape()}
  </article>`;
}

function desenhar() {
  const tipo = $m('#tipo').value, alvo = $m('#alvo').value, area = $m('#relatorio');
  let html = '';
  if (tipo === 'prof') {
    const lista = alvo === 'todos' ? [...$m('#alvo').options].slice(1).map((o) => base.profs.find((p) => p.id === o.value)) : [base.profs.find((p) => p.id === alvo)];
    html = lista.filter(Boolean).map(relProfessor).join('');
  } else {
    const lista = alvo === 'todos' ? [...$m('#alvo').options].slice(1).map((o) => base.turmas.find((t) => t.id === o.value)) : [base.turmas.find((t) => t.id === alvo)];
    html = lista.filter(Boolean).map(relTurma).join('');
  }
  area.innerHTML = html || `<p class="muted">${tipo === 'prof' ? 'Nenhum professor com aulas neste período.' : 'Nenhuma turma neste período.'}</p>`;
  $m('#imprimir').disabled = !html;
}

async function carregar() {
  if (!periodoId) { $m('#relatorio').innerHTML = '<p class="muted">Crie um período em Configurações acadêmicas.</p>'; $m('#imprimir').disabled = true; return; }
  $m('#relatorio').innerHTML = '<p class="carregando">Carregando…</p>';
  try { await carregarBase(); preencherAlvos(); desenhar(); }
  catch (e) { $m('#relatorio').innerHTML = ''; mostrarErro($m('#msg'), e); }
}

$m('#per').addEventListener('change', (e) => { periodoId = e.target.value; carregar(); });
$m('#tipo').addEventListener('change', () => { preencherAlvos(); desenhar(); });
$m('#alvo').addEventListener('change', desenhar);
$m('#imprimir').addEventListener('click', () => window.print());
carregar();
