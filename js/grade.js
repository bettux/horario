import { iniciarPagina, listarPeriodos, preencherPeriodos, avisar, mostrarErro, confirmar } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { esc, DIAS, mostrarAlerta } from './util.js';

const { main } = await iniciarPagina('grade');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Grade da graduação</h1>
    <p class="sub">Clique num horário vazio para adicionar uma aula. Nada é gravado até você salvar.</p></div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <span class="chip chip-red oculto" id="sujo"></span>
      <button class="btn" id="descartar" disabled>Descartar</button>
      <button class="btn btn-p" id="salvar" disabled>Salvar grade</button>
    </div>
  </header>
  <section class="card barra">
    <div class="campo" style="flex:0 1 150px"><label for="per">Período letivo</label><select id="per"></select></div>
    <div class="campo" style="flex:1 1 320px"><label for="turma">Turma</label><select id="turma"></select></div>
  </section>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="area"></div>`;

const $m = (s) => main.querySelector(s);
const msg = $m('#msg');

// ---------- dados fixos ----------
const [periodos, cursos, matrizes, horariosTodos, profsTodos] = await Promise.all([
  listarPeriodos(),
  q(sb.from('cursos').select('*')),
  q(sb.from('matrizes').select('*')),
  q(sb.from('horarios_graduacao').select('*').order('numero')),
  q(sb.from('professores').select('id, nome, cor, ativo').order('nome')),
]);
const HOR = { semana: horariosTodos.filter((h) => h.tipo_dia === 'semana'), sabado: horariosTodos.filter((h) => h.tipo_dia === 'sabado') };
const hm = (t) => t.slice(0, 5);
const tipoDia = (d) => (d === 6 ? 'sabado' : 'semana');
const slot = (d, n) => HOR[tipoDia(d)].find((h) => h.numero === n);
function horario(d, inicio, qtd) {
  const a = slot(d, inicio), b = slot(d, inicio + qtd - 1);
  return a && b ? { hi: hm(a.inicio), hf: hm(b.fim) } : null;
}
const sobrepoe = (x, y) => x && y && x.hi < y.hf && y.hi < x.hf;
const normAmb = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const profNome = (id) => profsTodos.find((p) => p.id === id)?.nome || '?';
const primeiroNome = (id) => profNome(id).split(' ')[0];

// ---------- estado ----------
let periodoId = preencherPeriodos($m('#per'), periodos);
let periodo = null, turma = null, comps = [], semanas = 20;
let outras = [], disp = [], posDias = [], ambientes = [];
let rascunho = [], salvoJson = '[]';
let painel = { modo: 'vazio' };
let seq = 0;

// ---------- seleção de turma ----------
async function carregarTurmas() {
  const sel = $m('#turma');
  if (!periodoId) { sel.innerHTML = '<option>Nenhum período</option>'; sel.disabled = true; $m('#area').innerHTML = '<p class="muted">Crie um período em Configurações acadêmicas.</p>'; return; }
  periodo = periodos.find((p) => p.id === periodoId);
  semanas = periodo.semanas_letivas || 20;
  const turmas = (await q(sb.from('turmas').select('*, subturmas(id, nome)').eq('periodo_id', periodoId).gt('semestre', 0)))
    .map((t) => { const m = matrizes.find((x) => x.id === t.matriz_id); const c = cursos.find((x) => x.id === m.curso_id); return { ...t, rotulo: `${c.sigla || c.nome} · ${m.nome} · ${t.semestre}º sem. · ${t.identificacao}` }; })
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo));
  if (!turmas.length) { sel.innerHTML = '<option>Nenhuma turma de graduação</option>'; sel.disabled = true; $m('#area').innerHTML = '<p class="muted">Crie as turmas em Gestão de turmas.</p>'; return; }
  sel.disabled = false;
  sel.innerHTML = turmas.map((t) => `<option value="${t.id}">${esc(t.rotulo)}</option>`).join('');
  const pedida = new URLSearchParams(location.search).get('turma') || sessionStorage.getItem('grade-turma');
  if (turmas.some((t) => t.id === pedida)) sel.value = pedida;
  sel._turmas = turmas;
  await carregarTurma(sel.value);
}

async function carregarTurma(id) {
  turma = $m('#turma')._turmas.find((t) => t.id === id);
  turma.subturmas.sort((a, b) => a.nome.localeCompare(b.nome));
  try { sessionStorage.setItem('grade-turma', id); } catch { /* ignora */ }
  $m('#area').innerHTML = '<p class="carregando">Carregando…</p>';
  msg.classList.add('oculto');

  const aulasPer = await q(sb.from('v_aulas_horario').select('*').eq('periodo_id', periodoId));
  const ids = aulasPer.map((a) => a.id);
  const [cs, apPer, asPer, dsp, enc, amb] = await Promise.all([
    q(sb.from('componentes').select('*').eq('matriz_id', turma.matriz_id).eq('semestre', turma.semestre).eq('ativo', true).order('ordem')),
    ids.length ? q(sb.from('aula_professores').select('aula_id, professor_id').in('aula_id', ids)) : [],
    ids.length ? q(sb.from('aula_subturmas').select('aula_id, subturma_id').in('aula_id', ids)) : [],
    q(sb.from('disponibilidades').select('*').eq('periodo_id', periodoId)),
    q(sb.from('v_encontros').select('professor_id, dia_semana').eq('periodo_id', periodoId)),
    q(sb.from('ambientes').select('id, nome').order('nome')),
  ]);
  comps = cs; disp = dsp; ambientes = amb;
  posDias = [...new Set(enc.map((e) => `${e.professor_id}|${e.dia_semana}`))];
  const nomeAmb = (aid) => amb.find((a) => a.id === aid)?.nome || '';
  const montar = (a) => ({
    chave: `s${seq++}`, id: a.id, componente_id: a.componente_id, dia_semana: a.dia_semana, inicio: a.inicio, quantidade: a.quantidade,
    ambiente: nomeAmb(a.ambiente_id),
    professores: apPer.filter((x) => x.aula_id === a.id).map((x) => x.professor_id),
    subturmas: asPer.filter((x) => x.aula_id === a.id).map((x) => x.subturma_id),
    turma_id: a.turma_id, componente: a.componente,
  });
  outras = aulasPer.filter((a) => a.turma_id !== turma.id).map(montar);
  rascunho = aulasPer.filter((a) => a.turma_id === turma.id).map(montar);
  salvoJson = assinatura(rascunho);
  painel = { modo: 'vazio' };

  // rascunho local não salvo?
  const guardado = lerRascunho();
  if (guardado && guardado.base === salvoJson && assinatura(guardado.aulas) !== salvoJson) {
    mostrarAlerta(msg, 'aviso', 'Há alterações desta turma que não foram salvas da última vez.');
    msg.insertAdjacentHTML('beforeend', ' <button class="btn btn-s" id="recuperar">Recuperar</button> <button class="btn btn-s" id="ignorar">Ignorar</button>');
    msg.querySelector('#recuperar').addEventListener('click', () => { rascunho = guardado.aulas.map((a) => ({ ...a, chave: `s${seq++}` })); msg.classList.add('oculto'); desenhar(); });
    msg.querySelector('#ignorar').addEventListener('click', () => { apagarRascunho(); msg.classList.add('oculto'); });
  }
  desenhar();
}

// ---------- rascunho ----------
function assinatura(lista) {
  return JSON.stringify(lista.map((a) => [a.componente_id, a.dia_semana, a.inicio, a.quantidade, normAmb(a.ambiente), [...a.professores].sort(), [...a.subturmas].sort()])
    .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))));
}
const chaveLocal = () => `grade-rascunho-${turma?.id}`;
function lerRascunho() { try { return JSON.parse(localStorage.getItem(chaveLocal()) || 'null'); } catch { return null; } }
function guardarRascunho() { try { localStorage.setItem(chaveLocal(), JSON.stringify({ base: salvoJson, aulas: rascunho })); } catch { /* ignora */ } }
function apagarRascunho() { try { localStorage.removeItem(chaveLocal()); } catch { /* ignora */ } }
const sujo = () => turma && assinatura(rascunho) !== salvoJson;
window.addEventListener('beforeunload', (ev) => { if (sujo()) { ev.preventDefault(); ev.returnValue = ''; } });

// ---------- contadores ----------
const ocupaHorario = (c) => ['presencial', 'ead_sincrona'].includes(c.modalidade);
function contador(c) {
  if (!ocupaHorario(c)) return { texto: c.modalidade === 'ead_assincrona' ? 'EAD assíncrona · não ocupa horário' : 'Não ocupa horário', pct: 100, completo: true, info: true };
  if (c.regra === 'pi_extensao') {
    const porSub = turma.subturmas.map((s) => rascunho.filter((a) => a.subturmas.includes(s.id) && comps.find((k) => k.id === a.componente_id)?.regra === 'pi_extensao').reduce((t, a) => t + a.quantidade, 0));
    const meu = Math.max(0, ...turma.subturmas.map((s) => rascunho.filter((a) => a.componente_id === c.id && a.subturmas.includes(s.id)).reduce((t, a) => t + a.quantidade, 0)));
    return { texto: `${meu}/semana · PI + Extensão somam ${Math.max(0, ...porSub)} de 2`, pct: Math.min(100, (Math.max(0, ...porSub) / 2) * 100), completo: meu > 0 };
  }
  const porSub = turma.subturmas.map((s) => ({ nome: s.nome, total: rascunho.filter((a) => a.componente_id === c.id && a.subturmas.includes(s.id)).reduce((t, a) => t + a.quantidade, 0) * semanas }));
  const iguais = porSub.every((x) => x.total === porSub[0].total);
  const carga = c.carga ?? 0;
  const texto = iguais ? `${porSub[0]?.total ?? 0}/${carga}` : porSub.map((x) => `${x.nome} ${x.total}/${carga}`).join(' · ');
  const min = Math.min(...porSub.map((x) => x.total));
  return { texto, pct: carga ? Math.min(100, (min / carga) * 100) : 0, completo: carga > 0 && min >= carga, excede: porSub.some((x) => x.total > carga) };
}

// ---------- checagens imediatas (o banco confere tudo de novo ao salvar) ----------
function checar(a) {
  const r = [];
  const c = comps.find((k) => k.id === a.componente_id);
  const h = horario(a.dia_semana, a.inicio, a.quantidade);
  if (!h) { r.push({ ok: false, t: 'Esse horário não cabe no dia (passa do último horário).' }); return r; }
  if (!a.subturmas.length) r.push({ ok: false, t: 'Marque pelo menos uma subturma.' });
  if (c.professor === 'obrigatorio' && !a.professores.length) r.push({ ok: false, t: 'Este componente precisa de professor.' });
  if (c.professor === 'sem' && a.professores.length) r.push({ ok: false, t: 'Este componente não leva professor.' });
  if (new Set(a.professores).size !== a.professores.length) r.push({ ok: false, t: 'O mesmo professor foi escolhido duas vezes.' });

  const outrasDaTurma = rascunho.filter((x) => x.chave !== a.chave);
  const choqueTurma = outrasDaTurma.find((x) => x.dia_semana === a.dia_semana && x.subturmas.some((s) => a.subturmas.includes(s)) && sobrepoe(h, horario(x.dia_semana, x.inicio, x.quantidade)));
  r.push(choqueTurma ? { ok: false, t: `A turma já tem ${comps.find((k) => k.id === choqueTurma.componente_id)?.nome} nesse horário.` } : { ok: true, t: 'Turma livre nesse horário' });

  for (const p of a.professores) {
    const nome = primeiroNome(p);
    const todas = [...outrasDaTurma, ...outras];
    const choque = todas.find((x) => x.dia_semana === a.dia_semana && x.professores.includes(p) && sobrepoe(h, horario(x.dia_semana, x.inicio, x.quantidade)));
    r.push(choque ? { ok: false, t: `${nome} já dá ${choque.componente || comps.find((k) => k.id === choque.componente_id)?.nome} nesse horário${choque.turma_id !== turma.id ? ' em outra turma' : ''}.` } : { ok: true, t: `${nome} sem outra aula nesse horário` });
    r.push(posDias.includes(`${p}|${a.dia_semana}`) ? { ok: false, t: `${nome} tem pós na ${DIAS[a.dia_semana].toLowerCase()} (a pós bloqueia o dia).` } : { ok: true, t: `${nome} sem pós na ${DIAS[a.dia_semana].toLowerCase()}` });
    const d = disp.find((x) => x.professor_id === p && x.dia_semana === a.dia_semana);
    r.push(d && hm(d.inicio) <= h.hi && hm(d.fim) >= h.hf ? { ok: true, t: `${nome} disponível` }
      : { ok: false, t: d ? `${nome} está disponível na ${DIAS[a.dia_semana].toLowerCase()} das ${hm(d.inicio)} às ${hm(d.fim)}.` : `${nome} não marcou disponibilidade na ${DIAS[a.dia_semana].toLowerCase()}.` });
  }

  if (normAmb(a.ambiente)) {
    const amb = [...outrasDaTurma, ...outras].find((x) => normAmb(x.ambiente) === normAmb(a.ambiente) && x.dia_semana === a.dia_semana && sobrepoe(h, horario(x.dia_semana, x.inicio, x.quantidade)));
    r.push(amb ? { ok: false, t: `${a.ambiente.trim()} já está ocupado nesse horário${amb.turma_id !== turma.id ? ' por outra turma' : ''}.` } : { ok: true, t: `${a.ambiente.trim()} livre nesse horário` });
  }

  const simulado = [...outrasDaTurma, a];
  if (c.regra === 'pi_extensao') {
    for (const s of turma.subturmas.filter((x) => a.subturmas.includes(x.id))) {
      const tot = simulado.filter((x) => x.subturmas.includes(s.id) && comps.find((k) => k.id === x.componente_id)?.regra === 'pi_extensao').reduce((t, x) => t + x.quantidade, 0);
      if (tot > 2) r.push({ ok: false, t: `PI + Extensão somariam ${tot} aulas por semana na ${s.nome}. O máximo é 2.` });
    }
  } else if (c.carga != null) {
    for (const s of turma.subturmas.filter((x) => a.subturmas.includes(x.id))) {
      const tot = simulado.filter((x) => x.componente_id === c.id && x.subturmas.includes(s.id)).reduce((t, x) => t + x.quantidade, 0) * semanas;
      r.push(tot > c.carga ? { ok: false, t: `${c.nome} passaria a ter ${tot} aulas na ${s.nome}. O previsto é ${c.carga}.` } : { ok: true, t: `${s.nome}: ${tot} de ${c.carga} aulas no semestre` });
    }
  }
  return r;
}

// ---------- desenho ----------
const ALT = 64, ALT_INT = 22;
function linhasDoDia(tipo) {
  const hs = HOR[tipo]; const out = []; let y = 0;
  hs.forEach((h, i) => {
    out.push({ tipo: 'slot', h, y }); y += ALT;
    const prox = hs[i + 1];
    if (prox && h.fim < prox.inicio) { out.push({ tipo: 'intervalo', de: hm(h.fim), ate: hm(prox.inicio), y }); y += ALT_INT; }
  });
  return { linhas: out, altura: y };
}
function topoDe(tipo, numero) { return linhasDoDia(tipo).linhas.find((l) => l.tipo === 'slot' && l.h.numero === numero)?.y ?? 0; }

function blocosDoDia(d) {
  const lista = rascunho.filter((a) => a.dia_semana === d).sort((a, b) => a.inicio - b.inicio);
  const pistas = []; // fim (número do slot) de cada pista
  for (const a of lista) {
    let p = pistas.findIndex((fim) => fim < a.inicio);
    if (p < 0) { p = pistas.length; pistas.push(0); }
    pistas[p] = a.inicio + a.quantidade - 1; a._pista = p;
  }
  return { lista, npistas: Math.max(1, pistas.length) };
}

function htmlGrade(tipo, dias) {
  const { linhas, altura } = linhasDoDia(tipo);
  const cols = `92px repeat(${dias.length}, minmax(${tipo === 'sabado' ? 200 : 120}px, 1fr))`;
  const rotulos = linhas.map((l) => l.tipo === 'slot'
    ? `<div style="position:absolute;top:${l.y}px;height:${ALT}px;display:flex;flex-direction:column;justify-content:center;font-size:12px;color:var(--texto-suave)"><b style="color:#2B2B30;font-size:12.5px">${l.h.numero}ª aula</b><span class="num">${hm(l.h.inicio)}–${hm(l.h.fim)}</span></div>`
    : `<div style="position:absolute;top:${l.y}px;height:${ALT_INT}px;display:flex;align-items:center;font-size:11px;font-weight:600;color:var(--texto-suave);white-space:nowrap" class="num">${l.de}–${l.ate}</div>`).join('');
  const colunas = dias.map((d) => {
    const { lista, npistas } = blocosDoDia(d);
    const vazios = linhas.filter((l) => l.tipo === 'slot').map((l) => `<button type="button" class="slot-vazio" data-add="${d}|${l.h.numero}" style="top:${l.y + 3}px;height:${ALT - 6}px" aria-label="Adicionar aula ${DIAS[d]} ${l.h.numero}ª aula">+</button>`).join('');
    const intervalos = linhas.filter((l) => l.tipo === 'intervalo').map((l) => `<div style="position:absolute;left:0;right:0;top:${l.y}px;height:${ALT_INT}px;background:#F4F4F6"></div>`).join('');
    const blocos = lista.map((a) => {
      const c = comps.find((k) => k.id === a.componente_id);
      const top = topoDe(tipo, a.inicio), fim = topoDe(tipo, a.inicio + a.quantidade - 1) + ALT;
      const cor = profsTodos.find((p) => p.id === a.professores[0])?.cor || '#8A8A93';
      const subs = turma.subturmas.filter((s) => a.subturmas.includes(s.id)).map((s) => s.nome).join('+');
      const sel = painel.aula?.chave === a.chave;
      const larg = 100 / npistas;
      return `<button type="button" class="bloco${sel ? ' bloco-sel' : ''}" data-editar="${a.chave}" style="top:${top + 3}px;height:${fim - top - 6}px;left:calc(${a._pista * larg}% + 3px);width:calc(${larg}% - 6px);background:linear-gradient(${cor}24, ${cor}24), #fff;border-color:${cor}99">
        <span class="bn">${esc(c?.nome || '?')}</span>
        <span class="bp">${a.professores.length ? a.professores.map(primeiroNome).map(esc).join(' + ') : '<i>sem professor</i>'}</span>
        <span class="bd">${esc(subs)}${a.ambiente ? ' · ' + esc(a.ambiente) : ''} · ${a.quantidade} aula${a.quantidade > 1 ? 's' : ''}</span></button>`;
    }).join('');
    return `<div style="position:relative;height:${altura}px;border-left:1px solid var(--linha)">${intervalos}${vazios}${blocos}</div>`;
  }).join('');
  return `<div class="grade" style="grid-template-columns:${cols}">
      <div></div>${dias.map((d) => `<div class="grade-dia">${DIAS[d]}</div>`).join('')}
      <div style="position:relative;height:${altura}px">${rotulos}</div>${colunas}
    </div>`;
}

function desenhar() {
  if (!turma) return;
  const d = sujo();
  if (d) guardarRascunho(); else apagarRascunho();
  $m('#sujo').classList.toggle('oculto', !d);
  $m('#sujo').textContent = 'Alterações não salvas';
  $m('#salvar').disabled = !d; $m('#descartar').disabled = !d;

  const completos = comps.filter((c) => contador(c).completo).length;
  $m('#area').innerHTML = `
    <div class="duas-colunas" style="align-items:flex-start">
      <section style="flex:3 1 600px;min-width:0;display:flex;flex-direction:column;gap:16px">
        <div class="card" style="padding:8px;overflow-x:auto">${htmlGrade('semana', [1, 2, 3, 4, 5])}</div>
        <div class="card" style="padding:8px;overflow-x:auto">
          <div style="display:flex;justify-content:space-between;gap:8px;padding:6px 8px 10px;flex-wrap:wrap"><strong>Sábado</strong><span class="muted" style="font-size:12.5px">EAD e Extensão · horários de 50 min</span></div>
          ${htmlGrade('sabado', [6])}
        </div>
      </section>
      <div style="flex:1 1 300px;max-width:380px;min-width:0;display:flex;flex-direction:column;gap:16px">
        <aside class="card painel" id="painel"></aside>
        <aside class="card painel" style="gap:8px">
          <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="font-size:15px">Componentes</h2><span class="muted num" style="font-size:12.5px">${completos} de ${comps.length} completos</span></div>
          <span class="muted" style="font-size:12px">Contagem: aulas por semana × ${semanas} semanas letivas.</span>
          ${comps.map((c) => { const k = contador(c); return `
            <div style="padding:9px 11px;border-radius:10px;border:1px solid #EEEEF1;display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span style="font-size:13.5px;font-weight:600;line-height:1.3">${esc(c.nome)}</span>
              ${k.info || c.regra === 'pi_extensao' ? '' : `<span class="num" style="font-size:12.5px;font-weight:700;white-space:nowrap;${k.excede ? 'color:var(--erro-chip)' : ''}">${esc(k.texto)}</span>`}</div>
              ${k.info ? '' : `<div style="height:5px;border-radius:999px;background:#EEEEF1;overflow:hidden"><div style="height:5px;border-radius:999px;width:${k.pct}%;background:${k.completo ? '#1F8A4C' : 'var(--vermelho)'}"></div></div>`}
              <span class="muted" style="font-size:12px;line-height:1.35">${c.regra === 'pi_extensao' ? esc(k.texto) : k.info ? esc(k.texto) : (c.modalidade === 'ead_sincrona' ? 'EAD síncrona · ' : '') + (c.professor === 'opcional' ? 'professor opcional' : c.professor === 'sem' ? 'sem professor' : 'presencial')}</span>
            </div>`; }).join('')}
        </aside>
      </div>
    </div>`;

  $m('#area').querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const [d, n] = b.dataset.add.split('|').map(Number);
    const primeiro = comps.find((c) => ocupaHorario(c) && !contador(c).completo) || comps.find(ocupaHorario);
    if (!primeiro) { avisar('Nenhum componente desta turma ocupa horário.', 'aviso'); return; }
    painel = { modo: 'novo', aula: { chave: `n${seq++}`, componente_id: primeiro.id, dia_semana: d, inicio: n, quantidade: Math.min(2, HOR[tipoDia(d)].length - n + 1), ambiente: '', professores: [], subturmas: turma.subturmas.map((s) => s.id) } };
    desenhar();
  }));
  $m('#area').querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
    const a = rascunho.find((x) => x.chave === b.dataset.editar);
    painel = { modo: 'editar', aula: structuredClone(a), original: a.chave };
    desenhar();
  }));
  desenharPainel();
}

function desenharPainel() {
  const el = $m('#painel');
  if (painel.modo === 'vazio') {
    el.innerHTML = `<h2>Como usar</h2>
      <p style="margin:0;font-size:13.5px;line-height:1.55;color:var(--texto-2)">Clique em um <strong>+</strong> da grade para adicionar uma aula, ou em uma aula para editar.</p>
      <p style="margin:0;font-size:13.5px;line-height:1.55;color:var(--texto-2)">Aula com T1+T2 juntas conta uma vez para o professor. Dois professores na mesma aula recebem a carga cheia cada um.</p>
      <p class="muted" style="margin:0;font-size:12.5px;line-height:1.5">Ao salvar, o sistema confere também a carga de 40 aulas por semana e a pós de cada professor. Se algo não passar, nada é gravado.</p>`;
    return;
  }
  const a = painel.aula;
  const c = comps.find((k) => k.id === a.componente_id);
  const tipo = tipoDia(a.dia_semana);
  const maxQtd = HOR[tipo].length - a.inicio + 1;
  const profsOp = profsTodos.filter((p) => p.ativo || a.professores.includes(p.id));
  const opProf = (sel) => `${c.professor !== 'obrigatorio' ? '<option value="">— sem professor —</option>' : '<option value="">Escolha…</option>'}${profsOp.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.nome)}</option>`).join('')}`;
  const h = horario(a.dia_semana, a.inicio, a.quantidade);
  const checks = checar(a);
  const ok = checks.every((x) => x.ok);
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2>${painel.modo === 'novo' ? 'Adicionar aula' : 'Editar aula'}</h2><button class="btn btn-s" type="button" id="fechar">Fechar</button></div>
    <div class="campo"><label for="p-comp">Componente</label><select id="p-comp">${comps.filter(ocupaHorario).map((k) => `<option value="${k.id}"${k.id === a.componente_id ? ' selected' : ''}>${esc(k.nome)}</option>`).join('')}</select></div>
    ${c.professor === 'sem' ? '<p class="muted" style="margin:0;font-size:13px">Este componente não leva professor.</p>' : `
    <div class="campo"><label for="p-prof1">Professor</label><select id="p-prof1">${opProf(a.professores[0])}</select></div>
    ${a.professores.length >= 1 || painel.segundo ? `<div class="campo"><label for="p-prof2">Segundo professor (opcional)</label><select id="p-prof2"><option value="">— nenhum —</option>${profsOp.map((p) => `<option value="${p.id}"${p.id === a.professores[1] ? ' selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>` : ''}`}
    <fieldset style="border:0;padding:0;margin:0"><legend class="rotulo" style="padding:0;margin-bottom:8px">Subturmas</legend>
      <div style="display:flex;gap:18px;flex-wrap:wrap">${turma.subturmas.map((s) => `<label class="check"><input type="checkbox" data-sub="${s.id}" ${a.subturmas.includes(s.id) ? 'checked' : ''}> ${esc(s.nome)}</label>`).join('')}</div></fieldset>
    <div class="linha-form" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div class="campo"><label for="p-dia">Dia</label><select id="p-dia">${[1, 2, 3, 4, 5, 6].map((d) => `<option value="${d}"${d === a.dia_semana ? ' selected' : ''}>${DIAS[d]}</option>`).join('')}</select></div>
      <div class="campo"><label for="p-ini">Início</label><select id="p-ini">${HOR[tipo].map((x) => `<option value="${x.numero}"${x.numero === a.inicio ? ' selected' : ''}>${x.numero}ª · ${hm(x.inicio)}</option>`).join('')}</select></div>
      <div class="campo"><label for="p-qtd">Quantidade</label><select id="p-qtd">${Array.from({ length: Math.max(1, maxQtd) }, (_, i) => i + 1).map((n) => `<option value="${n}"${n === a.quantidade ? ' selected' : ''}>${n} aula${n > 1 ? 's' : ''}</option>`).join('')}</select></div>
      <div class="campo"><label>Horário</label><input value="${h ? `${h.hi} – ${h.hf}` : '—'}" readonly style="background:#F7F7F9"></div>
    </div>
    <div class="campo"><label for="p-amb">Ambiente</label><input id="p-amb" list="lista-amb" value="${esc(a.ambiente)}" placeholder="Ex.: Lab. 02" autocomplete="off">
      <datalist id="lista-amb">${ambientes.map((x) => `<option value="${esc(x.nome)}">`).join('')}</datalist></div>
    <div class="requisitos" style="gap:6px">${checks.map((x) => `<div class="req${x.ok ? ' ok' : ' falha'}">${esc(x.t)}</div>`).join('')}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-p" type="button" id="aplicar" ${ok ? '' : 'disabled'}>${painel.modo === 'novo' ? 'Adicionar à grade' : 'Aplicar alteração'}</button>
      ${painel.modo === 'editar' ? '<button class="btn" type="button" id="remover">Remover aula</button>' : ''}
    </div>`;

  const atualizar = (fn) => { fn(a); desenharPainel(); };
  el.querySelector('#fechar').addEventListener('click', () => { painel = { modo: 'vazio' }; desenhar(); });
  el.querySelector('#p-comp').addEventListener('change', (e) => atualizar((x) => {
    x.componente_id = e.target.value;
    const k = comps.find((cc) => cc.id === x.componente_id);
    if (k.professor === 'sem') x.professores = [];
  }));
  el.querySelector('#p-prof1')?.addEventListener('change', (e) => atualizar((x) => { x.professores = [e.target.value, x.professores[1]].filter(Boolean); }));
  el.querySelector('#p-prof2')?.addEventListener('change', (e) => atualizar((x) => { x.professores = [x.professores[0], e.target.value].filter(Boolean); }));
  el.querySelectorAll('[data-sub]').forEach((cb) => cb.addEventListener('change', () => atualizar((x) => { x.subturmas = [...el.querySelectorAll('[data-sub]:checked')].map((i) => i.dataset.sub); })));
  el.querySelector('#p-dia').addEventListener('change', (e) => atualizar((x) => { x.dia_semana = +e.target.value; const n = HOR[tipoDia(x.dia_semana)].length; if (x.inicio > n) x.inicio = 1; if (x.inicio + x.quantidade - 1 > n) x.quantidade = n - x.inicio + 1; }));
  el.querySelector('#p-ini').addEventListener('change', (e) => atualizar((x) => { x.inicio = +e.target.value; const n = HOR[tipoDia(x.dia_semana)].length; if (x.inicio + x.quantidade - 1 > n) x.quantidade = n - x.inicio + 1; }));
  el.querySelector('#p-qtd').addEventListener('change', (e) => atualizar((x) => { x.quantidade = +e.target.value; }));
  el.querySelector('#p-amb').addEventListener('change', (e) => atualizar((x) => { x.ambiente = e.target.value.trim().replace(/\s+/g, ' '); }));
  el.querySelector('#aplicar').addEventListener('click', () => {
    if (painel.modo === 'novo') rascunho.push(a);
    else rascunho = rascunho.map((x) => (x.chave === painel.original ? a : x));
    painel = { modo: 'vazio' };
    desenhar();
  });
  el.querySelector('#remover')?.addEventListener('click', () => {
    rascunho = rascunho.filter((x) => x.chave !== painel.original);
    painel = { modo: 'vazio' };
    desenhar();
  });
}

// ---------- salvar / descartar ----------
$m('#salvar').addEventListener('click', async () => {
  const botao = $m('#salvar');
  botao.disabled = true; botao.textContent = 'Salvando…';
  msg.classList.add('oculto');
  try {
    const payload = rascunho.map((a) => ({
      componente_id: a.componente_id, dia_semana: a.dia_semana, inicio: a.inicio, quantidade: a.quantidade,
      ambiente: a.ambiente || null, professores: a.professores, subturmas: a.subturmas,
    }));
    await rpc('salvar_grade_turma', { p_turma: turma.id, p_aulas: payload });
    apagarRascunho();
    avisar('Grade salva.');
    await carregarTurma(turma.id);
  } catch (e) {
    mostrarErro(msg, e);
    botao.disabled = false;
  } finally {
    botao.textContent = 'Salvar grade';
  }
});
$m('#descartar').addEventListener('click', async () => {
  if (!(await confirmar('Descartar alterações?', 'A grade volta ao que está salvo no banco.', 'Descartar', true))) return;
  apagarRascunho();
  await carregarTurma(turma.id);
});

// ---------- troca de período / turma ----------
let turmaAnterior = null;
$m('#per').addEventListener('change', async (e) => {
  if (sujo() && !(await confirmar('Sair sem salvar?', 'As alterações desta turma ficam guardadas como rascunho neste navegador.', 'Trocar'))) { e.target.value = periodoId; return; }
  periodoId = e.target.value; await carregarTurmas();
});
$m('#turma').addEventListener('focus', () => { turmaAnterior = $m('#turma').value; });
$m('#turma').addEventListener('change', async (e) => {
  if (sujo() && !(await confirmar('Trocar de turma?', 'As alterações desta turma ficam guardadas como rascunho neste navegador.', 'Trocar'))) { e.target.value = turmaAnterior; return; }
  await carregarTurma(e.target.value);
});

await carregarTurmas();
