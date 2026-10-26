import { iniciarPagina, listarPeriodos, preencherPeriodos, mostrarErro } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { esc, somaDias, segundaDaSemana } from './util.js';
import { htmlSemana, limitarSemana, rotuloSemana } from './semana.js';

const { main } = await iniciarPagina('agenda');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Agenda docente</h1>
    <p class="sub">A semana de um professor em todos os cursos, com graduação e pós.</p></div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="campo" style="width:240px"><label for="prof">Professor</label><select id="prof"></select></div>
      <div class="campo" style="width:120px"><label for="per">Período</label><select id="per"></select></div>
      <button class="btn" type="button" id="ant" aria-label="Semana anterior">‹</button>
      <div class="num" id="rotulo-semana" style="min-height:38px;display:flex;align-items:center;padding:0 14px;border-radius:8px;background:#fff;border:1px solid var(--borda-forte);font-weight:600"></div>
      <button class="btn" type="button" id="prox" aria-label="Próxima semana">›</button>
      <button class="btn" type="button" id="hoje">Esta semana</button>
    </div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="conteudo"><p class="carregando">Carregando…</p></div>`;

const $m = (s) => main.querySelector(s);
const [periodos, profs] = await Promise.all([listarPeriodos(), q(sb.from('professores').select('id, nome, nif, ativo').order('nome'))]);
let periodoId = preencherPeriodos($m('#per'), periodos);
$m('#prof').innerHTML = profs.map((p) => `<option value="${p.id}">${esc(p.nome)}${p.ativo ? '' : ' (inativo)'} · NIF ${esc(p.nif)}</option>`).join('');
const pedido = new URLSearchParams(location.search).get('professor') || sessionStorage.getItem('agenda-prof');
if (profs.some((p) => p.id === pedido)) $m('#prof').value = pedido;

let dados = null, periodo = null, segunda = null;

async function carregar() {
  if (!periodoId) { $m('#conteudo').innerHTML = '<p class="muted">Crie um período em Configurações acadêmicas.</p>'; return; }
  periodo = periodos.find((p) => p.id === periodoId);
  try { sessionStorage.setItem('agenda-prof', $m('#prof').value); } catch { /* ignora */ }
  $m('#conteudo').innerHTML = '<p class="carregando">Carregando…</p>';
  try { dados = await rpc('agenda_professor', { p_prof: $m('#prof').value, p_periodo: periodoId }); }
  catch (e) { mostrarErro($m('#msg'), e); return; }
  if (!segunda) segunda = limitarSemana(segundaDaSemana(new Date()), periodo);
  else segunda = limitarSemana(segunda, periodo);
  desenhar();
}
function desenhar() {
  $m('#rotulo-semana').textContent = rotuloSemana(segunda);
  $m('#conteudo').innerHTML = htmlSemana(dados, periodo, segunda, { mostrarProfessores: true });
}

$m('#prof').addEventListener('change', carregar);
$m('#per').addEventListener('change', (e) => { periodoId = e.target.value; segunda = null; carregar(); });
$m('#ant').addEventListener('click', () => { segunda = limitarSemana(somaDias(segunda, -7), periodo); desenhar(); });
$m('#prox').addEventListener('click', () => { segunda = limitarSemana(somaDias(segunda, 7), periodo); desenhar(); });
$m('#hoje').addEventListener('click', () => { segunda = limitarSemana(segundaDaSemana(new Date()), periodo); desenhar(); });
if (profs.length) carregar(); else $m('#conteudo').innerHTML = '<p class="muted">Cadastre professores primeiro.</p>';
