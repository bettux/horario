import { exigirSessao } from './auth.js';
import { montarLayout } from './layout.js';
import { rpc } from './supabase.js';
import { isoData, somaDias, segundaDaSemana, mostrarAlerta } from './util.js';
import { htmlSemana, limitarSemana, rotuloSemana } from './semana.js';

const perfil = await exigirSessao();
const main = montarLayout(perfil, 'minhas');

main.innerHTML = `
  <header class="cabecalho">
    <div>
      <h1>Minhas aulas</h1>
      <p class="sub">Somente as suas aulas. Para alterar algo, fale com a coordenação.</p>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="campo" style="width:140px"><label for="per">Período letivo</label><select id="per"></select></div>
      <button class="btn" type="button" id="ant" aria-label="Semana anterior">‹</button>
      <div class="num" id="rotulo-semana" style="min-height:38px;display:flex;align-items:center;padding:0 14px;border-radius:8px;background:#fff;border:1px solid var(--borda-forte);font-weight:600"></div>
      <button class="btn" type="button" id="prox" aria-label="Próxima semana">›</button>
      <button class="btn" type="button" id="hoje">Esta semana</button>
    </div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="conteudo"><p class="carregando">Carregando…</p></div>`;

const sel = main.querySelector('#per');
const conteudo = main.querySelector('#conteudo');
let periodos = [], dados = null, periodo = null, segunda = null;

try { periodos = await rpc('meus_periodos'); }
catch (e) { mostrarAlerta(main.querySelector('#msg'), 'erro', e.message); }

if (!periodos.length) {
  conteudo.innerHTML = '<div class="card" style="padding:24px"><p style="margin:0">Você ainda não tem aulas atribuídas em nenhum período.</p></div>';
  main.querySelectorAll('header button, header select').forEach((b) => (b.disabled = true));
} else {
  sel.innerHTML = periodos.map((p) => `<option value="${p.id}">${p.ano}/${p.semestre}</option>`).join('');
  const hoje = isoData(new Date());
  const atual = periodos.find((p) => p.inicio <= hoje && hoje <= p.fim) || periodos[0];
  sel.value = atual.id;
  await carregarPeriodo(atual.id);
  sel.addEventListener('change', () => carregarPeriodo(sel.value));
  main.querySelector('#ant').addEventListener('click', () => { segunda = limitarSemana(somaDias(segunda, -7), periodo); desenhar(); });
  main.querySelector('#prox').addEventListener('click', () => { segunda = limitarSemana(somaDias(segunda, 7), periodo); desenhar(); });
  main.querySelector('#hoje').addEventListener('click', () => { segunda = limitarSemana(segundaDaSemana(new Date()), periodo); desenhar(); });
}

async function carregarPeriodo(id) {
  periodo = periodos.find((p) => p.id === id);
  conteudo.innerHTML = '<p class="carregando">Carregando…</p>';
  try { dados = await rpc('minhas_aulas', { p_periodo: id }); }
  catch (e) { mostrarAlerta(main.querySelector('#msg'), 'erro', e.message); return; }
  segunda = limitarSemana(segundaDaSemana(new Date()), periodo);
  desenhar();
}

function desenhar() {
  main.querySelector('#rotulo-semana').textContent = rotuloSemana(segunda);
  conteudo.innerHTML = htmlSemana(dados, periodo, segunda);
}
