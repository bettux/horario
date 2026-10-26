import { iniciarPagina, listarPeriodos, preencherPeriodos, avisar, mostrarErro, confirmar } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { esc, DIAS, parseData, isoData, somaDias, segundaDaSemana, ddmm, ddmmaaaa, diaIso, duracao } from './util.js';

const { main } = await iniciarPagina('pos');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Planejamento da pós</h1>
    <p class="sub">Semana e Sábado são planejamentos separados. Cada módulo é salvo quando você confirma.</p></div>
  </header>
  <section class="card barra">
    <div class="campo" style="flex:0 1 150px"><label for="per">Período letivo</label><select id="per"></select></div>
    <div class="campo" style="flex:1 1 300px"><label for="turma">Turma de pós</label><select id="turma"></select></div>
    <div class="campo"><span class="rotulo">Modo</span>
      <div class="seg" role="group" aria-label="Modo da pós">
        <button type="button" class="sb" data-modo="semana">Semana</button>
        <button type="button" class="sb" data-modo="sabado">Sábado</button>
      </div></div>
  </section>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="area"></div>`;

const $m = (s) => main.querySelector(s);
const msg = $m('#msg');
const NOME_FMT = { '10_semanas': '10 semanas · 3h', '8_semanas': '8 semanas · 3h45', manha: 'Manhã', tarde: 'Tarde', integral: 'Dia inteiro' };

const [periodos, cursos, matrizes, horariosPos, profs] = await Promise.all([
  listarPeriodos(),
  q(sb.from('cursos').select('*')),
  q(sb.from('matrizes').select('*')),
  q(sb.from('horarios_pos').select('*')),
  q(sb.from('professores').select('id, nome, cor, ativo').order('nome')),
]);
const HP = Object.fromEntries(horariosPos.map((h) => [h.formato, { inicio: h.inicio.slice(0, 5), fim: h.fim.slice(0, 5), minutos: h.minutos_aula }]));
const profNome = (id) => profs.find((p) => p.id === id)?.nome || '?';
const profCor = (id) => profs.find((p) => p.id === id)?.cor || '#8A8A93';

let periodoId = preencherPeriodos($m('#per'), periodos);
let periodo = null, turma = null, modo = sessionStorage.getItem('pos-modo') || 'semana';
let modulos = [], ofertas = [], encontros = [], feriados = [], ambientes = [];
let gradDias = [], disp = [], encontrosPeriodo = [];
let verTudo = false;

function marcarModo() { main.querySelectorAll('[data-modo]').forEach((b) => { b.classList.toggle('sb-on', b.dataset.modo === modo); b.setAttribute('aria-pressed', String(b.dataset.modo === modo)); }); }
main.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => { modo = b.dataset.modo; try { sessionStorage.setItem('pos-modo', modo); } catch { /* ignora */ } marcarModo(); desenhar(); }));
marcarModo();

async function carregarTurmas() {
  const sel = $m('#turma');
  if (!periodoId) { sel.innerHTML = '<option>—</option>'; sel.disabled = true; $m('#area').innerHTML = '<p class="muted">Crie um período em Configurações acadêmicas.</p>'; return; }
  periodo = periodos.find((p) => p.id === periodoId);
  const ts = (await q(sb.from('turmas').select('*').eq('periodo_id', periodoId).eq('semestre', 0)))
    .map((t) => { const m = matrizes.find((x) => x.id === t.matriz_id); const c = cursos.find((x) => x.id === m.curso_id); return { ...t, rotulo: `${c.nome} · ${t.identificacao}`, curso: c }; })
    .filter((t) => t.curso.nivel === 'pos').sort((a, b) => a.rotulo.localeCompare(b.rotulo));
  if (!ts.length) { sel.innerHTML = '<option>Nenhuma turma de pós</option>'; sel.disabled = true; $m('#area').innerHTML = '<p class="muted">Crie a turma de pós em Gestão de turmas.</p>'; return; }
  sel.disabled = false;
  sel.innerHTML = ts.map((t) => `<option value="${t.id}">${esc(t.rotulo)}</option>`).join('');
  const salva = sessionStorage.getItem('pos-turma');
  if (ts.some((t) => t.id === salva)) sel.value = salva;
  sel._turmas = ts;
  await carregarTurma(sel.value);
}

async function carregarTurma(id) {
  turma = $m('#turma')._turmas.find((t) => t.id === id);
  try { sessionStorage.setItem('pos-turma', id); } catch { /* ignora */ }
  $m('#area').innerHTML = '<p class="carregando">Carregando…</p>';
  const aulasPer = await q(sb.from('v_aulas_horario').select('id, dia_semana').eq('periodo_id', periodoId));
  const ids = aulasPer.map((a) => a.id);
  const [mods, ofs, fer, amb, ap, dsp, encPer] = await Promise.all([
    q(sb.from('componentes').select('*').eq('matriz_id', turma.matriz_id).eq('ativo', true).in('modalidade', ['pos', 'tcc']).order('ordem')),
    q(sb.from('ofertas_pos').select('*').eq('turma_id', turma.id)),
    q(sb.from('dias_nao_letivos').select('data, motivo').eq('periodo_id', periodoId)),
    q(sb.from('ambientes').select('nome').order('nome')),
    ids.length ? q(sb.from('aula_professores').select('aula_id, professor_id').in('aula_id', ids)) : [],
    q(sb.from('disponibilidades').select('*').eq('periodo_id', periodoId)),
    q(sb.from('v_encontros').select('*').eq('periodo_id', periodoId)),
  ]);
  modulos = mods; ofertas = ofs; feriados = fer; ambientes = amb; disp = dsp; encontrosPeriodo = encPer;
  encontros = encPer.filter((e) => e.turma_id === turma.id);
  gradDias = ap.map((x) => `${x.professor_id}|${aulasPer.find((a) => a.id === x.aula_id).dia_semana}`);
  desenhar();
}

// ---------- contadores ----------
function minutosDe(compId, m) {
  const of = ofertas.find((o) => o.componente_id === compId && o.modo === m);
  return of ? encontros.filter((e) => e.oferta_id === of.id).reduce((t, e) => t + e.minutos, 0) : 0;
}

// ---------- calendário ----------
function semanasDoPeriodo() {
  const ini = segundaDaSemana(parseData(periodo.inicio)), fim = parseData(periodo.fim);
  const out = []; for (let s = ini, n = 1; s <= fim; s = somaDias(s, 7), n++) out.push({ n, seg: s });
  return out;
}

function desenhar() {
  if (!turma) return;
  const semanas = semanasDoPeriodo();
  const mostrar = verTudo ? semanas : semanas.slice(0, 10);
  const ferMap = Object.fromEntries(feriados.map((f) => [f.data, f.motivo]));
  const doModo = encontros.filter((e) => e.modo === modo);
  const celula = (iso, filtro) => {
    const dt = parseData(iso);
    if (dt < parseData(periodo.inicio) || dt > parseData(periodo.fim)) return '<div class="pcel pcel-fora"></div>';
    if (ferMap[iso]) return `<div class="pcel pcel-fer"><b>Não letivo</b><span>${esc(ferMap[iso])}</span></div>`;
    const es = doModo.filter((e) => e.data === iso && filtro(e));
    if (!es.length) return '<div class="pcel"></div>';
    return es.map((e) => {
      const of = ofertas.find((o) => o.id === e.oferta_id);
      const tot = encontros.filter((x) => x.oferta_id === e.oferta_id).sort((a, b) => a.data.localeCompare(b.data) || a.inicio.localeCompare(b.inicio));
      const n = tot.findIndex((x) => x.id === e.id) + 1;
      const cor = profCor(of.professor_id);
      return `<button type="button" class="pcel pcel-aula" data-mod="${e.componente_id}" style="background:linear-gradient(${cor}24, ${cor}24), #fff;border-color:${cor}99" title="${esc(e.componente)} · ${esc(profNome(of.professor_id))}">
        <b>${esc(e.componente)}</b><span>${esc(profNome(of.professor_id).split(' ')[0])} · ${e.inicio.slice(0, 5)}–${e.fim.slice(0, 5)} · ${n}/${tot.length}</span></button>`;
    }).join('');
  };
  const cab = modo === 'semana'
    ? `<div class="prow pcab"><span>Semana</span>${[1, 2, 3, 4, 5].map((d) => `<span>${DIAS[d]}</span>`).join('')}</div>`
    : `<div class="prow prow-sab pcab"><span>Semana</span><span>Manhã · ${HP.manha?.inicio}–${HP.manha?.fim}</span><span>Tarde · ${HP.tarde?.inicio}–${HP.tarde?.fim}</span></div>`;
  const linhas = mostrar.map((s) => {
    const rot = `<span class="pwk num"><b>Sem. ${s.n}</b>${ddmm(s.seg)}${modo === 'semana' ? ' a ' + ddmm(somaDias(s.seg, 4)) : ''}</span>`;
    if (modo === 'semana') return `<div class="prow">${rot}${[0, 1, 2, 3, 4].map((i) => `<div class="pdia">${celula(isoData(somaDias(s.seg, i)), () => true)}</div>`).join('')}</div>`;
    const sab = isoData(somaDias(s.seg, 5));
    return `<div class="prow prow-sab"><span class="pwk num"><b>Sem. ${s.n}</b>${ddmm(somaDias(s.seg, 5))}</span>
      <div class="pdia">${celula(sab, (e) => e.inicio < '12:30')}</div><div class="pdia">${celula(sab, (e) => e.inicio >= '12:30')}</div></div>`;
  }).join('');

  $m('#area').innerHTML = `
    <div class="duas-colunas" style="align-items:flex-start">
      <aside class="card painel" style="flex:1 1 260px;max-width:330px;gap:8px">
        <h2 style="font-size:15px">Módulos</h2>
        <span class="muted" style="font-size:12px">Clique para planejar ou editar no modo ${modo === 'semana' ? 'Semana' : 'Sábado'}.</span>
        ${modulos.map((c) => {
          if (c.modalidade === 'tcc') return `<div class="pmod" style="background:#FAFAFB"><b>${esc(c.nome)}</b><span class="muted" style="font-size:12px">Orientação lançada em Atividades complementares.</span></div>`;
          const sem = minutosDe(c.id, 'semana'), sab = minutosDe(c.id, 'sabado'), alvo = (c.carga ?? 30) * 60;
          const of = ofertas.find((o) => o.componente_id === c.id && o.modo === modo);
          const chip = (m, v) => `<span class="pchip${m === modo ? ' on' : ''}${v >= alvo ? ' ok' : ''}">${m === 'semana' ? 'Semana' : 'Sábado'} ${duracao(v)}/${c.carga ?? 30}h</span>`;
          return `<button type="button" class="pmod" data-mod="${c.id}"><b>${esc(c.nome)}</b>
            <span style="display:flex;gap:6px;flex-wrap:wrap">${chip('semana', sem)}${chip('sabado', sab)}</span>
            <span class="muted" style="font-size:12px">${of ? `${esc(profNome(of.professor_id))} · ${NOME_FMT[of.formato]}` : 'Não planejado neste modo'}</span></button>`;
        }).join('') || '<p class="muted">Nenhum módulo na matriz.</p>'}
      </aside>
      <section class="card" style="flex:3 1 560px;min-width:0;padding:14px;overflow-x:auto">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;padding-bottom:10px">
          <h2 style="font-size:15px">${modo === 'semana' ? 'Semana' : 'Sábado'} · ${verTudo ? `semanas 1 a ${semanas.length}` : '1º período (semanas 1 a 10)'}</h2>
          <span class="muted" style="font-size:12.5px">${esc(turma.identificacao)} · ${(() => { const n = encontros.filter((e) => e.modo === modo).length; return n === 1 ? '1 encontro salvo' : n + ' encontros salvos'; })()} neste modo</span>
        </div>
        <div style="min-width:${modo === 'semana' ? 640 : 420}px">${cab}${linhas}</div>
        ${semanas.length > 10 ? `<button class="btn" type="button" id="ver-tudo" style="margin-top:10px">${verTudo ? 'Mostrar só o 1º período' : `Mostrar 2º período (semanas 11 a ${semanas.length})`}</button>` : ''}
      </section>
    </div>`;
  $m('#ver-tudo')?.addEventListener('click', () => { verTudo = !verTudo; desenhar(); });
  main.querySelectorAll('[data-mod]').forEach((b) => b.addEventListener('click', () => abrirModulo(b.dataset.mod)));
}

// ---------- geração de datas ----------
function gerarDatas({ primeira, formato, alvoMin }) {
  const fer = new Set(feriados.map((f) => f.data));
  const fim = parseData(periodo.fim);
  const out = [];
  let total = 0;
  const pulados = [];
  for (let d = parseData(primeira); d <= fim && total < alvoMin; d = somaDias(d, 7)) {
    const iso = isoData(d);
    if (fer.has(iso)) { pulados.push(iso); continue; }
    const turnos = formato === 'integral' ? ['manha', 'tarde'] : [formato];
    for (const t of turnos) {
      if (total >= alvoMin) break;
      const h = HP[t];
      out.push({ data: iso, inicio: h.inicio, fim: h.fim, minutos: h.minutos });
      total += h.minutos;
    }
  }
  return { encontros: out, total, pulados };
}

// ---------- janela do módulo ----------
function abrirModulo(compId) {
  const c = modulos.find((x) => x.id === compId);
  const of = ofertas.find((o) => o.componente_id === compId && o.modo === modo);
  const alvoMin = (c.carga ?? 30) * 60;
  let lista = of ? encontros.filter((e) => e.oferta_id === of.id).map((e) => ({ data: e.data, inicio: e.inicio.slice(0, 5), fim: e.fim.slice(0, 5), minutos: e.minutos, ambiente: '' })).sort((a, b) => a.data.localeCompare(b.data) || a.inicio.localeCompare(b.inicio)) : [];
  const ambSalvo = of ? (encontros.find((e) => e.oferta_id === of.id && e.ambiente_id)?.ambiente_id) : null;
  let pulados = [];
  const formatos = modo === 'semana' ? ['10_semanas', '8_semanas'] : ['manha', 'tarde', 'integral'];
  const estado = {
    professor: of?.professor_id || '', formato: of?.formato || formatos[0],
    dia: of && lista[0] ? diaIso(parseData(lista[0].data)) : 1,
    primeira: lista[0]?.data || '', ambiente: '',
  };

  const dlg = document.createElement('dialog');
  dlg.className = 'dialogo';
  dlg.style.width = 'min(640px, calc(100vw - 32px))';
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());

  // nome do ambiente salvo
  if (ambSalvo) sb.from('ambientes').select('nome').eq('id', ambSalvo).single().then(({ data }) => { if (data && !estado.ambiente) { estado.ambiente = data.nome; render(); } });

  function avisosProfessor() {
    const r = [];
    if (!estado.professor) return r;
    const nome = profNome(estado.professor).split(' ')[0];
    const dias = [...new Set(lista.map((e) => diaIso(parseData(e.data))))];
    for (const d of dias) {
      if (gradDias.includes(`${estado.professor}|${d}`)) r.push({ ok: false, t: `${nome} tem aula de graduação na ${DIAS[d].toLowerCase()}. A pós bloqueia o dia inteiro.` });
      const dp = disp.find((x) => x.professor_id === estado.professor && x.dia_semana === d);
      const ini = lista.find((e) => diaIso(parseData(e.data)) === d);
      if (!dp) r.push({ ok: false, t: `${nome} não marcou disponibilidade na ${DIAS[d].toLowerCase()}.` });
      else if (ini && (dp.inicio.slice(0, 5) > ini.inicio || dp.fim.slice(0, 5) < ini.fim)) r.push({ ok: false, t: `${nome} está disponível na ${DIAS[d].toLowerCase()} das ${dp.inicio.slice(0, 5)} às ${dp.fim.slice(0, 5)}.` });
    }
    const outros = encontrosPeriodo.filter((e) => e.professor_id === estado.professor && !(e.turma_id === turma.id && e.componente_id === c.id && e.modo === modo));
    const choque = lista.find((x) => outros.some((e) => e.data === x.data && e.inicio.slice(0, 5) < x.fim && x.inicio < e.fim.slice(0, 5)));
    if (choque) r.push({ ok: false, t: `${nome} já tem outro encontro de pós em ${ddmmaaaa(parseData(choque.data))}.` });
    if (!r.length && lista.length) r.push({ ok: true, t: `${nome}: sem graduação nesses dias, disponível e sem outro encontro` });
    return r;
  }

  function render() {
    const total = lista.reduce((t, e) => t + e.minutos, 0);
    const checks = [
      ...(lista.length ? [{ ok: total <= alvoMin, t: `${duracao(total)} de ${c.carga ?? 30}h em ${lista.length} encontros${total < alvoMin ? ' (incompleto)' : ''}` }] : []),
      ...avisosProfessor(),
    ];
    const podeSalvar = lista.length && estado.professor && total <= alvoMin && checks.every((x) => x.ok || x.t.includes('incompleto'));
    dlg.innerHTML = `<form method="dialog" class="dialogo-form">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><h2>${esc(c.nome)}</h2><p class="muted" style="margin:4px 0 0;font-size:13px">${esc(turma.rotulo)} · modo ${modo === 'semana' ? 'Semana' : 'Sábado'}</p></div><button class="btn btn-s" type="button" data-fechar>Fechar</button></div>
      <div class="linha-form" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="campo"><label for="m-prof">Professor</label><select id="m-prof"><option value="">Escolha…</option>${profs.filter((p) => p.ativo || p.id === estado.professor).map((p) => `<option value="${p.id}"${p.id === estado.professor ? ' selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label for="m-amb">Ambiente</label><input id="m-amb" list="m-lamb" value="${esc(estado.ambiente)}" placeholder="Ex.: Sala 21" autocomplete="off"><datalist id="m-lamb">${ambientes.map((a) => `<option value="${esc(a.nome)}">`).join('')}</datalist></div>
      </div>
      <fieldset style="border:0;padding:0;margin:0"><legend class="rotulo" style="padding:0;margin-bottom:8px">Formato</legend>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${formatos.map((f) => {
          const h = f === 'integral' ? { inicio: HP.manha.inicio, fim: HP.tarde.fim } : HP[f];
          const enc = Math.ceil(alvoMin / (f === 'integral' ? HP.manha.minutos + HP.tarde.minutos : HP[f].minutos));
          return `<label class="opt${estado.formato === f ? ' opt-on' : ''}"><input type="radio" name="fmt" value="${f}" ${estado.formato === f ? 'checked' : ''}><span><b>${NOME_FMT[f]}</b><br><span class="muted num">${h.inicio}–${h.fim} · ${enc} ${modo === 'semana' ? 'encontros' : 'sábados'}</span></span></label>`;
        }).join('')}</div></fieldset>
      <div class="linha-form" style="grid-template-columns:${modo === 'semana' ? '1fr 1fr auto' : '1fr auto'};align-items:end">
        ${modo === 'semana' ? `<div class="campo"><label for="m-dia">Dia da semana</label><select id="m-dia">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}"${d === estado.dia ? ' selected' : ''}>${DIAS[d]}</option>`).join('')}</select></div>` : ''}
        <div class="campo"><label for="m-pri">1º encontro</label><input id="m-pri" type="date" value="${estado.primeira}" min="${periodo.inicio}" max="${periodo.fim}"></div>
        <button class="btn" type="button" id="m-gerar">${lista.length ? 'Gerar de novo' : 'Gerar datas'}</button>
      </div>
      ${lista.length ? `<div style="border:1px solid var(--borda);border-radius:10px;max-height:220px;overflow:auto">
        ${lista.map((e, i) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid var(--linha);font-size:13px">
          <span class="num">${i + 1}. ${DIAS[diaIso(parseData(e.data))].slice(0, 3)} ${ddmmaaaa(parseData(e.data))} · ${e.inicio}–${e.fim} · ${duracao(e.minutos)}</span>
          <button type="button" class="btn btn-s" data-rm="${i}" aria-label="Remover encontro ${i + 1}">Remover</button></div>`).join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-s" type="button" id="m-completar" ${total >= alvoMin ? 'disabled' : ''}>Completar com as próximas datas</button>
        ${pulados.length ? `<span class="muted" style="font-size:12.5px;align-self:center">Pulou dia não letivo: ${pulados.map((p) => ddmm(parseData(p))).join(', ')}</span>` : ''}</div>` : '<p class="muted" style="margin:0;font-size:13px">Escolha o formato e o 1º encontro e clique em Gerar datas. Os dias não letivos são pulados.</p>'}
      ${checks.length ? `<div class="requisitos" style="gap:6px">${checks.map((x) => `<div class="req${x.ok ? ' ok' : x.t.includes('incompleto') ? '' : ' falha'}">${esc(x.t)}</div>`).join('')}</div>` : ''}
      <div class="oculto" data-msg role="alert"></div>
      <div class="dialogo-acoes" style="justify-content:space-between">
        <span>${of ? '<button class="btn" type="button" id="m-remover">Remover planejamento</button>' : ''}</span>
        <button class="btn btn-p" type="button" id="m-salvar" ${podeSalvar ? '' : 'disabled'}>Salvar módulo</button>
      </div></form>`;

    const v = (s) => dlg.querySelector(s);
    v('[data-fechar]').addEventListener('click', () => dlg.close());
    v('#m-prof').addEventListener('change', (e) => { estado.professor = e.target.value; render(); });
    v('#m-amb').addEventListener('change', (e) => { estado.ambiente = e.target.value.trim(); });
    dlg.querySelectorAll('input[name=fmt]').forEach((r) => r.addEventListener('change', () => { estado.formato = r.value; lista = []; render(); }));
    v('#m-dia')?.addEventListener('change', (e) => { estado.dia = +e.target.value; estado.primeira = ''; render(); });
    v('#m-pri').addEventListener('change', (e) => { estado.primeira = e.target.value; });
    v('#m-gerar').addEventListener('click', () => {
      const box = v('[data-msg]');
      let pri = estado.primeira;
      const diaAlvo = modo === 'semana' ? estado.dia : 6;
      if (!pri) {
        // primeira data do período nesse dia da semana
        let d = parseData(periodo.inicio); while (diaIso(d) !== diaAlvo) d = somaDias(d, 1); pri = isoData(d);
      }
      if (diaIso(parseData(pri)) !== diaAlvo) { mostrarErro(box, new Error(`O 1º encontro precisa ser ${modo === 'semana' ? 'numa ' + DIAS[diaAlvo].toLowerCase() : 'num sábado'}.`)); return; }
      estado.primeira = pri;
      const r = gerarDatas({ primeira: pri, formato: estado.formato, alvoMin });
      lista = r.encontros; pulados = r.pulados;
      render();
      if (r.total < alvoMin) mostrarErro(v('[data-msg]'), new Error(`O período termina antes de completar as ${c.carga ?? 30}h. Escolha uma data inicial mais cedo ou complete em outro modo.`));
    });
    dlg.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { lista.splice(+b.dataset.rm, 1); render(); }));
    v('#m-completar')?.addEventListener('click', () => {
      const ult = lista[lista.length - 1];
      const prox = isoData(somaDias(parseData(ult.data), 7));
      const r = gerarDatas({ primeira: prox, formato: estado.formato, alvoMin: alvoMin - lista.reduce((t, e) => t + e.minutos, 0) });
      lista = [...lista, ...r.encontros]; pulados = [...pulados, ...r.pulados];
      render();
    });
    v('#m-remover')?.addEventListener('click', async () => {
      if (!(await confirmar('Remover planejamento?', `Todos os encontros de ${c.nome} no modo ${modo === 'semana' ? 'Semana' : 'Sábado'} serão apagados.`, 'Remover', true))) return;
      try {
        await rpc('salvar_oferta_pos', { p_turma: turma.id, p_componente: c.id, p_modo: modo, p_professor: of.professor_id, p_formato: of.formato, p_encontros: [] });
        avisar('Planejamento removido.'); dlg.close(); carregarTurma(turma.id);
      } catch (e) { mostrarErro(v('[data-msg]'), e); }
    });
    v('#m-salvar').addEventListener('click', async () => {
      const botao = v('#m-salvar');
      botao.disabled = true; botao.textContent = 'Salvando…';
      try {
        await rpc('salvar_oferta_pos', {
          p_turma: turma.id, p_componente: c.id, p_modo: modo, p_professor: estado.professor, p_formato: estado.formato,
          p_encontros: lista.map((e) => ({ ...e, ambiente: (v('#m-amb').value || '').trim() || null })),
        });
        avisar(`${c.nome}: ${lista.length} encontros salvos.`); dlg.close(); carregarTurma(turma.id);
      } catch (e) {
        mostrarErro(v('[data-msg]'), e);
        botao.disabled = false; botao.textContent = 'Salvar módulo';
      }
    });
  }
  render();
  dlg.showModal();
}

$m('#per').addEventListener('change', (e) => { periodoId = e.target.value; verTudo = false; carregarTurmas(); });
$m('#turma').addEventListener('change', (e) => carregarTurma(e.target.value));
await carregarTurmas();
