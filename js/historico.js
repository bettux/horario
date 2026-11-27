import { iniciarPagina, listarPeriodos, periodoRotulo, mostrarErro } from './pagina.js?v=202611271105';
import { sb, q } from './supabase.js?v=202611271105';
import { esc, DIAS, parseData, ddmmaaaa } from './util.js?v=202611271105';

// Histórico de alterações (somente ADM): quem mudou o quê e quando
const { main } = await iniciarPagina('historico');

const TIPOS = {
  grade: 'Grade da graduação', pos: 'Pós-graduação', atribuicoes: 'Professores das matérias', disponibilidade: 'Disponibilidade',
  turmas: 'Turmas', subturmas: 'Subturmas', periodos: 'Períodos', dias_nao_letivos: 'Dias não letivos', compensacoes: 'Sábados de compensação', professores: 'Professores',
  atividades: 'Atividades complementares', componentes: 'Matrizes (componentes)', copia: 'Cópia de período',
};
const CAMPOS = {
  identificacao: 'Identificação', nome: 'Nome', nif: 'NIF', cor: 'Cor', ativo: 'Ativo', perfil: 'Perfil', inicio: 'Início', fim: 'Fim',
  semanas_letivas: 'Semanas letivas', visivel_professor: 'Visível para professores', calendario_em: 'Calendário', motivo: 'Motivo',
  reposicao_em: 'Reposição', data: 'Data', descricao: 'Descrição', quantidade: 'Quantidade', frequencia: 'Frequência', tipo: 'Tipo',
  observacao: 'Observação', sigla: 'Sigla', carga: 'Carga', modalidade: 'Modalidade', regra: 'Regra', semestre: 'Semestre', ordem: 'Ordem',
  professor: 'Professor', ano: 'Ano', dia_semana: 'Vale como',
};
const POR_PAGINA = 100;

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Histórico de alterações</h1>
    <p class="sub">Quem mudou o quê e quando. Os registros começam a partir de 18/11/2026.</p></div>
  </header>
  <section class="card barra">
    <div class="campo" style="flex:0 1 160px"><label for="f-per">Período</label><select id="f-per"><option value="">Todos</option></select></div>
    <div class="campo" style="flex:0 1 230px"><label for="f-tipo">Tipo</label><select id="f-tipo"><option value="">Todos</option>
      ${Object.entries(TIPOS).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
    <div class="campo" style="flex:0 1 240px"><label for="f-autor">Quem alterou</label><select id="f-autor"><option value="">Todos</option></select></div>
  </section>
  <div id="msg" class="oculto" role="alert"></div>
  <section class="card" style="overflow:hidden"><div id="lista"><p class="carregando" style="padding:16px">Carregando…</p></div></section>
  <div style="display:flex;justify-content:center"><button class="btn oculto" type="button" id="mais">Carregar mais</button></div>`;

const $m = (s) => main.querySelector(s);
const periodos = await listarPeriodos();
$m('#f-per').insertAdjacentHTML('beforeend', periodos.map((p) => `<option value="${p.id}">${periodoRotulo(p)}</option>`).join(''));
const profs = await q(sb.from('professores').select('nome, perfil').eq('perfil', 'adm').order('nome'));
$m('#f-autor').insertAdjacentHTML('beforeend', profs.map((p) => `<option>${esc(p.nome)}</option>`).join(''));

let pagina = 0, itens = [];

// ---------- descrições ----------
const dia3 = (d) => DIAS[d]?.slice(0, 3).toLowerCase() || '?';
const fmtAula = (a) => `<b>${esc(a.c)}</b>${a.s ? ` (${esc(a.s)})` : ''} · ${dia3(a.d)} ${a.i}–${a.f} · ${esc(a.p || 'sem professor')}${a.a ? ' · ' + esc(a.a) : ''}`;
const chave = (o) => JSON.stringify(o);

function difLista(antes, depois) {
  const a = (antes || []).map(chave), d = (depois || []).map(chave);
  return { saiu: (antes || []).filter((x, i) => !d.includes(a[i])), entrou: (depois || []).filter((x, i) => !a.includes(d[i])) };
}

function detalheGrade(h) {
  const { saiu, entrou } = difLista(h.antes, h.depois);
  const linhas = [];
  const usados = new Set();
  // mesma matéria e subturma saindo e entrando = aula movida/alterada
  for (const s of saiu) {
    const i = entrou.findIndex((e, k) => !usados.has(k) && e.c === s.c && e.s === s.s);
    if (i >= 0) { usados.add(i); linhas.push(`<li><span class="hist-tag hist-alt">alterou</span>${fmtAula(s)} <span class="hist-seta">→</span> ${dia3(entrou[i].d)} ${entrou[i].i}–${entrou[i].f} · ${esc(entrou[i].p || 'sem professor')}${entrou[i].a ? ' · ' + esc(entrou[i].a) : ''}</li>`); }
    else linhas.push(`<li><span class="hist-tag hist-rem">removeu</span>${fmtAula(s)}</li>`);
  }
  entrou.forEach((e, k) => { if (!usados.has(k)) linhas.push(`<li><span class="hist-tag hist-add">incluiu</span>${fmtAula(e)}</li>`); });
  return linhas;
}

function detalheAtrib(h) {
  const antes = new Map((h.antes || []).map((x) => [`${x.c}|${x.s}`, x])), depois = new Map((h.depois || []).map((x) => [`${x.c}|${x.s}`, x]));
  const linhas = [];
  for (const [k, d] of depois) {
    const a = antes.get(k);
    if (!a) linhas.push(`<li><span class="hist-tag hist-add">definiu</span><b>${esc(d.c)}</b> (${esc(d.s)}): ${esc(d.p)}</li>`);
    else if (a.p !== d.p) linhas.push(`<li><span class="hist-tag hist-alt">trocou</span><b>${esc(d.c)}</b> (${esc(d.s)}): ${esc(a.p)} <span class="hist-seta">→</span> ${esc(d.p)}</li>`);
  }
  for (const [k, a] of antes) if (!depois.has(k)) linhas.push(`<li><span class="hist-tag hist-rem">tirou</span><b>${esc(a.c)}</b> (${esc(a.s)}): ${esc(a.p)}</li>`);
  return linhas;
}

function detalheDisp(h) {
  const txt = (l) => (l || []).map((x) => `${dia3(x.d)} ${x.i}–${x.f}`).join(', ') || 'nenhum horário';
  return [`<li><span class="hist-tag hist-alt">antes</span>${esc(txt(h.antes))}</li>`, `<li><span class="hist-tag hist-add">agora</span>${esc(txt(h.depois))}</li>`];
}

function detalhePos(h) {
  const a = h.antes, d = h.depois, l = [];
  const datas = (x) => (x?.datas?.length ? `${x.datas.length} encontros (${x.datas[0]} a ${x.datas[x.datas.length - 1]})` : 'sem encontros');
  if (!a) return [`<li><span class="hist-tag hist-add">criou</span>${esc(d?.p || 'sem professor')} · ${esc(datas(d))}${d?.a ? ' · ' + esc(d.a) : ''}</li>`];
  if (!d) return [`<li><span class="hist-tag hist-rem">removeu</span>${esc(a.p || 'sem professor')} · ${esc(datas(a))}</li>`];
  if (a.p !== d.p) l.push(`<li><span class="hist-tag hist-alt">professor</span>${esc(a.p || '—')} <span class="hist-seta">→</span> ${esc(d.p || '—')}</li>`);
  if (chave(a.datas) !== chave(d.datas)) l.push(`<li><span class="hist-tag hist-alt">datas</span>${esc(datas(a))} <span class="hist-seta">→</span> ${esc(datas(d))}</li>`);
  if (a.a !== d.a) l.push(`<li><span class="hist-tag hist-alt">ambiente</span>${esc(a.a || '—')} <span class="hist-seta">→</span> ${esc(d.a || '—')}</li>`);
  if (a.f !== d.f) l.push(`<li><span class="hist-tag hist-alt">formato</span>${esc(a.f)} <span class="hist-seta">→</span> ${esc(d.f)}</li>`);
  return l;
}

function valor(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return ddmmaaaa(parseData(v));
  if (k === 'calendario_em') return 'enviado';
  if (k === 'dia_semana') return DIAS[v] || String(v);
  return String(v);
}
function detalheLinha(h) {
  if (h.tipo === 'compensacoes' && h.acao !== 'alterou') {
    const r = h.depois || h.antes || {};
    return [`<li>Vale como <b>${esc(DIAS[r.dia_semana] || '?')}</b>${r.motivo ? ' · ' + esc(r.motivo) : ''}</li>`];
  }
  if (h.acao !== 'alterou') return [];
  const ign = (k) => k === 'id' || k.endsWith('_id') || k === 'auth_user_id' || k === 'criado_em' || k === 'chave';
  return Object.keys({ ...(h.antes || {}), ...(h.depois || {}) }).filter((k) => !ign(k) && chave(h.antes?.[k]) !== chave(h.depois?.[k]))
    .map((k) => `<li><span class="hist-tag hist-alt">${esc(CAMPOS[k] || k)}</span>${esc(valor(k, h.antes?.[k]))} <span class="hist-seta">→</span> ${esc(valor(k, h.depois?.[k]))}</li>`);
}

function detalheCopia(h) {
  const r = h.depois || {};
  return [`<li>Copiado de <b>${esc(h.alvo)}</b>: ${r.turmas_criadas} turma(s) criada(s), ${r.subturmas} subturma(s), ${r.atribuicoes} professor(es) de matéria, ${r.disponibilidades} horário(s) de disponibilidade, ${r.aulas} aula(s).</li>`];
}

function descrever(h) {
  const det = { grade: detalheGrade, atribuicoes: detalheAtrib, disponibilidade: detalheDisp, pos: detalhePos, copia: detalheCopia }[h.tipo] || detalheLinha;
  return det(h);
}

function desenhar() {
  const lista = $m('#lista');
  if (!itens.length) { lista.innerHTML = '<p class="muted" style="padding:16px;margin:0">Nenhuma alteração encontrada com esses filtros.</p>'; return; }
  let diaAtual = '';
  lista.innerHTML = itens.map((h) => {
    const dt = new Date(h.em);
    const dia0 = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const dia = dia0.charAt(0).toUpperCase() + dia0.slice(1);
    const cab = dia !== diaAtual ? `<div class="hist-dia">${esc(dia)}</div>` : '';
    diaAtual = dia;
    const linhas = descrever(h);
    return `${cab}<article class="hist-item">
      <span class="hist-hora num">${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
      <div class="hist-corpo">
        <div><b>${esc(h.autor)}</b> ${esc(h.acao)} <span class="chip chip-neu">${esc(TIPOS[h.tipo] || h.tipo)}</span>${h.alvo && h.tipo !== 'copia' ? ` · ${esc(h.alvo)}` : ''}</div>
        ${linhas.length ? `<ul class="hist-lista">${linhas.join('')}</ul>` : ''}
      </div></article>`;
  }).join('');
}

async function carregar(mais = false) {
  if (!mais) { pagina = 0; itens = []; $m('#lista').innerHTML = '<p class="carregando" style="padding:16px">Carregando…</p>'; }
  try {
    let c = sb.from('v_historico').select('*').order('em', { ascending: false }).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    if ($m('#f-per').value) c = c.eq('periodo_id', $m('#f-per').value);
    if ($m('#f-tipo').value) c = c.eq('tipo', $m('#f-tipo').value);
    if ($m('#f-autor').value) c = c.eq('autor', $m('#f-autor').value);
    const novos = await q(c);
    itens = itens.concat(novos);
    pagina++;
    $m('#mais').classList.toggle('oculto', novos.length < POR_PAGINA);
    desenhar();
  } catch (e) { mostrarErro($m('#msg'), e); }
}

['#f-per', '#f-tipo', '#f-autor'].forEach((s) => $m(s).addEventListener('change', () => carregar()));
$m('#mais').addEventListener('click', () => carregar(true));
carregar();
