import { exigirSessao } from './auth.js?v=202611271051';
import { montarLayout } from './layout.js?v=202611271051';
import { rpc } from './supabase.js?v=202611271051';
import { esc, DIAS, parseData, ddmmaaaa, mostrarAlerta } from './util.js?v=202611271051';
import { avisar, mostrarErro } from './pagina.js?v=202611271051';

// Meu planejamento (professor): disponibilidade do período e matérias que domina
const perfil = await exigirSessao();
const main = montarLayout(perfil, 'planejamento-prof');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Meu planejamento</h1>
    <p class="sub">Informe à coordenação os dias em que pode dar aula e as matérias que você domina. Tudo é salvo enquanto você preenche.</p></div>
    <div class="campo" style="width:150px"><label for="per">Período</label><select id="per"></select></div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="conteudo"><p class="carregando">Carregando…</p></div>`;

const $p = (s) => main.querySelector(s);
const conteudo = $p('#conteudo');
const NIVEIS = [['domino', 'Domino', 'Ministro sem preparação'], ['conheco', 'Conheço', 'Ministro com preparação'], ['sem_interesse', 'Sem interesse', '']];
const hm = (t) => String(t || '').slice(0, 5);
let dados = null, aba = 'disp', cursoSel = null, busca = '', soMarcadas = false;

let coletas = [];
try { coletas = await rpc('minhas_coletas'); } catch (e) { mostrarErro($p('#msg'), e); }
if (!coletas.length) {
  $p('#per').disabled = true;
  conteudo.innerHTML = '<div class="card" style="padding:24px"><p style="margin:0;line-height:1.6">Nenhuma coleta aberta no momento. Quando a coordenação abrir, aparece um aviso em <a href="minhas-aulas.html">Minhas aulas</a>.</p></div>';
} else {
  $p('#per').innerHTML = coletas.map((c) => `<option value="${c.periodo_id}">${c.ano}/${c.semestre}</option>`).join('');
  $p('#per').addEventListener('change', () => carregar($p('#per').value));
  carregar(coletas[0].periodo_id);
}

async function carregar(id) {
  conteudo.innerHTML = '<p class="carregando">Carregando…</p>';
  try { dados = await rpc('minha_coleta', { p_periodo: id }); }
  catch (e) { conteudo.innerHTML = ''; mostrarErro($p('#msg'), e); return; }
  if (!cursoSel || !dados.cursos.some((c) => c.id === cursoSel)) cursoSel = dados.cursos.find((c) => dados.componentes.some((k) => k.curso_id === c.id))?.id || null;
  desenhar();
}

const liberada = () => dados.periodo.liberada;

function desenhar() {
  const p = dados.periodo;
  const marcadas = Object.values(dados.competencias);
  const status = dados.enviado_em
    ? `<span class="chip chip-ok">Enviado em ${new Date(dados.enviado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>`
    : '<span class="chip chip-aviso">Ainda não enviado</span>';
  conteudo.innerHTML = `
    <section class="card mp-topo">
      <div><strong>Coleta ${p.ano}/${p.semestre}</strong> ${status}</div>
      <span class="muted">${liberada() ? (p.prazo ? `Prazo: até ${ddmmaaaa(parseData(p.prazo))}. Até lá você pode mudar e reenviar.` : 'Você pode mudar e reenviar enquanto a coleta estiver aberta.') : 'Prazo encerrado: só consulta. Para mudar, fale com a coordenação.'}</span>
    </section>
    <div class="abas" role="tablist">
      <button class="aba" role="tab" data-aba="disp" aria-selected="${aba === 'disp'}">1. Disponibilidade</button>
      <button class="aba" role="tab" data-aba="mat" aria-selected="${aba === 'mat'}">2. Matérias <span class="muted">(${marcadas.length})</span></button>
      <button class="aba" role="tab" data-aba="env" aria-selected="${aba === 'env'}">3. Enviar</button>
    </div>
    <div id="aba"></div>`;
  conteudo.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => { aba = b.dataset.aba; desenhar(); }));
  ({ disp: abaDisp, mat: abaMat, env: abaEnv })[aba]();
}

// ---------- 1. disponibilidade: um intervalo por dia ----------
function abaDisp() {
  const HS = dados.horarios.filter((h) => h.tipo_dia === 'semana'), HSAB = dados.horarios.filter((h) => h.tipo_dia === 'sabado');
  const atual = (d) => dados.disponibilidade.find((x) => x.dia === d);
  const linha = (d) => {
    const L = d === 6 ? HSAB : HS, a = atual(d);
    const ini = a ? hm(a.inicio) : hm(L[0]?.inicio), fim = a ? hm(a.fim) : hm(L[L.length - 1]?.fim);
    const opIni = L.map((h) => `<option value="${hm(h.inicio)}"${hm(h.inicio) === ini ? ' selected' : ''}>${hm(h.inicio)}</option>`).join('');
    const opFim = L.map((h) => `<option value="${hm(h.fim)}"${hm(h.fim) === fim ? ' selected' : ''}>${hm(h.fim)}</option>`).join('');
    // horário fora da lista (cadastrado pela coordenação): mantém
    const extraIni = a && !L.some((h) => hm(h.inicio) === ini) ? `<option value="${ini}" selected>${ini}</option>` : '';
    const extraFim = a && !L.some((h) => hm(h.fim) === fim) ? `<option value="${fim}" selected>${fim}</option>` : '';
    return `<div class="mp-dia${a ? ' mp-on' : ''}" data-dia="${d}">
      <label class="mp-tog"><input type="checkbox" data-on${a ? ' checked' : ''}${liberada() ? '' : ' disabled'}><span>${DIAS[d]}</span></label>
      <div class="mp-faixa"><span class="muted">das</span><select data-ini aria-label="${DIAS[d]} início"${liberada() ? '' : ' disabled'}>${extraIni}${opIni}</select>
        <span class="muted">às</span><select data-fim aria-label="${DIAS[d]} fim"${liberada() ? '' : ' disabled'}>${extraFim}${opFim}</select>
        <button type="button" class="btn btn-s" data-toda${liberada() ? '' : ' disabled'}>${d === 6 ? 'Sábado todo' : 'Noite toda'}</button></div>
    </div>`;
  };
  const temAnterior = dados.disponibilidade_anterior.length > 0;
  $p('#aba').innerHTML = `
    <section class="card painel" style="max-width:760px">
      <p style="margin:0;line-height:1.55">Marque os dias em que você <strong>pode dar aula</strong> neste período e o horário de cada um. Dia desmarcado = indisponível.</p>
      <div class="mp-dias">${[1, 2, 3, 4, 5, 6].map(linha).join('')}</div>
      <div id="msg-disp" class="oculto" role="alert"></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        ${liberada() ? `<button type="button" class="btn btn-p" id="salvar-disp">Salvar disponibilidade</button>
        ${temAnterior ? '<button type="button" class="btn" id="copiar">Copiar do semestre anterior</button>' : ''}` : ''}
        <button type="button" class="btn" id="ir-mat">Próximo: matérias →</button>
      </div>
    </section>`;
  const caixa = $p('#aba');
  caixa.querySelectorAll('.mp-dia').forEach((el) => {
    el.querySelector('[data-on]').addEventListener('change', (e) => el.classList.toggle('mp-on', e.target.checked));
    el.querySelector('[data-toda]').addEventListener('click', () => {
      const L = el.dataset.dia === '6' ? HSAB : HS;
      el.querySelector('[data-ini]').value = hm(L[0]?.inicio);
      el.querySelector('[data-fim]').value = hm(L[L.length - 1]?.fim);
      el.querySelector('[data-on]').checked = true; el.classList.add('mp-on');
    });
  });
  caixa.querySelector('#ir-mat').addEventListener('click', () => { aba = 'mat'; desenhar(); });
  caixa.querySelector('#copiar')?.addEventListener('click', () => {
    dados.disponibilidade = dados.disponibilidade_anterior.map((x) => ({ ...x }));
    abaDisp(); avisar('Copiado do semestre anterior. Confira e clique em Salvar.', 'aviso');
  });
  caixa.querySelector('#salvar-disp')?.addEventListener('click', async (ev) => {
    const dias = [...caixa.querySelectorAll('.mp-dia')].filter((el) => el.querySelector('[data-on]').checked).map((el) => ({
      dia: +el.dataset.dia, inicio: el.querySelector('[data-ini]').value, fim: el.querySelector('[data-fim]').value }));
    const m = $p('#msg-disp'); m.classList.add('oculto');
    const ruim = dias.find((d) => d.inicio >= d.fim);
    if (ruim) { mostrarAlerta(m, 'erro', `${DIAS[ruim.dia]}: o início precisa ser antes do fim.`); return; }
    ev.target.disabled = true;
    try {
      await rpc('prof_salvar_disponibilidade', { p_periodo: dados.periodo.id, p_dias: dias });
      dados.disponibilidade = dias;
      avisar(dias.length ? `Disponibilidade salva: ${dias.length} dia(s).` : 'Disponibilidade salva: nenhum dia marcado.');
    } catch (e) { mostrarErro(m, e); } finally { ev.target.disabled = false; }
  });
}

// ---------- 2. matérias ----------
function abaMat() {
  const cursos = dados.cursos.filter((c) => dados.componentes.some((k) => k.curso_id === c.id));
  $p('#aba').innerHTML = `
    <section class="card painel">
      <div class="barra" style="padding:0">
        <div class="campo" style="flex:0 1 320px"><label for="mp-curso">Curso</label><select id="mp-curso">${cursos.map((c) => `<option value="${c.id}"${c.id === cursoSel ? ' selected' : ''}>${esc(c.sigla ? `${c.sigla} · ${c.nome}` : c.nome)}${c.nivel === 'pos' ? ' (pós)' : ''}</option>`).join('')}</select></div>
        <div class="campo" style="flex:1 1 220px"><label for="mp-busca">Buscar matéria</label><input id="mp-busca" type="search" value="${esc(busca)}" placeholder="Nome da matéria"></div>
        <label class="check" style="align-self:flex-end;min-height:38px"><input type="checkbox" id="mp-so"${soMarcadas ? ' checked' : ''}> Só as que marquei</label>
      </div>
      <p class="muted" style="margin:0;font-size:13px;line-height:1.5"><strong>Domino</strong> = ministro sem preparação · <strong>Conheço</strong> = ministro com preparação · <strong>Sem interesse</strong> = não quero dar. Tudo começa em "Sem interesse". Cada toque já fica salvo e vale para os próximos semestres (é só revisar).</p>
      <div id="mp-resumo" class="mp-resumo"></div>
      <div id="mp-lista"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn" id="volta">← Disponibilidade</button><button type="button" class="btn btn-p" id="ir-env">Próximo: enviar →</button></div>
    </section>`;
  const sel = $p('#mp-curso');
  sel.addEventListener('change', () => { cursoSel = sel.value; lista(); });
  $p('#mp-busca').addEventListener('input', (e) => { busca = e.target.value; lista(); });
  $p('#mp-so').addEventListener('change', (e) => { soMarcadas = e.target.checked; lista(); });
  $p('#volta').addEventListener('click', () => { aba = 'disp'; desenhar(); });
  $p('#ir-env').addEventListener('click', () => { aba = 'env'; desenhar(); });
  lista();
}

function lista() {
  const termo = busca.trim().toLowerCase();
  const doCurso = dados.componentes.filter((k) => k.curso_id === cursoSel);
  const visiveis = doCurso.filter((k) => (!termo || k.nome.toLowerCase().includes(termo)) && (!soMarcadas || dados.competencias[k.id]));
  const conta = (n) => doCurso.filter((k) => dados.competencias[k.id] === n).length;
  $p('#mp-resumo').innerHTML = `<span class="chip chip-ok">${conta('domino')} Domino</span><span class="chip chip-aviso">${conta('conheco')} Conheço</span><span class="muted">neste curso · ${Object.keys(dados.competencias).length} marcadas no total</span>`;
  const grupos = new Map();
  for (const k of visiveis) { const g = k.semestre ? `${k.semestre}º semestre` : 'Módulos'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(k); }
  $p('#mp-lista').innerHTML = grupos.size ? [...grupos].map(([g, ks]) => `<div class="mp-grupo"><h3>${esc(g)}</h3>${ks.map((k) => {
    const n = dados.competencias[k.id] || 'sem_interesse';
    return `<div class="mp-mat"><span class="mp-nome">${esc(k.nome)}${k.modalidade?.startsWith('ead') ? ' <span class="chip chip-neu">EAD</span>' : ''}</span>
      <div class="seg mp-niveis" role="radiogroup" aria-label="${esc(k.nome)}">${NIVEIS.map(([v, r, d]) => `<button type="button" class="sb mp-${v}${v === n ? ' sb-on' : ''}" role="radio" aria-checked="${v === n}" data-comp="${k.id}" data-nivel="${v}" title="${esc(d || r)}"${liberada() ? '' : ' disabled'}>${r}</button>`).join('')}</div></div>`;
  }).join('')}</div>`).join('') : '<p class="muted" style="margin:0">Nenhuma matéria encontrada.</p>';
  $p('#mp-lista').querySelectorAll('[data-nivel]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.comp, novo = b.dataset.nivel, antes = dados.competencias[id] || 'sem_interesse';
    if (novo === antes) return;
    const grupo = b.parentElement;
    grupo.querySelectorAll('[data-nivel]').forEach((x) => { const on = x.dataset.nivel === novo; x.classList.toggle('sb-on', on); x.setAttribute('aria-checked', on); });
    if (novo === 'sem_interesse') delete dados.competencias[id]; else dados.competencias[id] = novo;
    try { await rpc('prof_salvar_competencia', { p_componente: id, p_nivel: novo }); }
    catch (e) {
      if (antes === 'sem_interesse') delete dados.competencias[id]; else dados.competencias[id] = antes;
      avisar(e.message, 'erro');
    }
    lista();
  }));
}

// ---------- 3. enviar ----------
function abaEnv() {
  const disp = dados.disponibilidade;
  const marc = dados.componentes.filter((k) => dados.competencias[k.id]);
  const cursoNome = (id) => dados.cursos.find((c) => c.id === id)?.sigla || '';
  $p('#aba').innerHTML = `
    <section class="card painel" style="max-width:760px">
      <h2>Confira antes de enviar</h2>
      <div><strong>Disponibilidade</strong>${disp.length ? `<ul class="mp-ul">${disp.map((d) => `<li>${DIAS[d.dia]}: ${hm(d.inicio)} às ${hm(d.fim)}</li>`).join('')}</ul>` : '<p class="muted" style="margin:4px 0 0">Nenhum dia marcado. Volte ao passo 1.</p>'}</div>
      <div><strong>Matérias</strong>${marc.length ? `<ul class="mp-ul">${marc.map((k) => `<li>${esc(k.nome)} <span class="muted">(${esc(cursoNome(k.curso_id))})</span>: <strong>${dados.competencias[k.id] === 'domino' ? 'Domino' : 'Conheço'}</strong></li>`).join('')}</ul>` : '<p class="muted" style="margin:4px 0 0">Nenhuma matéria marcada.</p>'}</div>
      <div id="msg-env" class="oculto" role="alert"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn" id="volta">← Matérias</button>
        ${liberada() ? `<button type="button" class="btn btn-p" id="enviar">${dados.enviado_em ? 'Reenviar para a coordenação' : 'Enviar para a coordenação'}</button>` : ''}
      </div>
    </section>`;
  $p('#volta').addEventListener('click', () => { aba = 'mat'; desenhar(); });
  $p('#enviar')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      dados.enviado_em = await rpc('prof_enviar_coleta', { p_periodo: dados.periodo.id });
      avisar('Enviado para a coordenação. Obrigado!'); desenhar();
    } catch (e) { mostrarErro($p('#msg-env'), e); ev.target.disabled = false; }
  });
}
