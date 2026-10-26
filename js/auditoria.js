import { iniciarPagina, listarPeriodos, preencherPeriodos, mostrarErro } from './pagina.js';
import { rpc } from './supabase.js';
import { esc } from './util.js';
import { carregarAnalise } from './analise.js';

const { main } = await iniciarPagina('auditoria');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Auditoria</h1>
    <p class="sub">Verifica o planejamento salvo. Apenas lê os dados, nada é alterado.</p></div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="campo" style="width:150px"><label for="per">Período letivo</label><select id="per"></select></div>
      <button class="btn btn-p" id="verificar">Verificar agora</button>
    </div>
  </header>
  <div class="alerta alerta-aviso">Choques de horário, carga acima de 40, aula fora da disponibilidade e ambiente ocupado já são bloqueados na hora de salvar. A auditoria encontra o que muda depois (feriado cadastrado mais tarde, professor inativado, horários alterados) e o que ainda falta planejar.</div>
  <div id="msg" class="oculto" role="alert"></div>
  <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">
    <div class="seg" role="group" aria-label="Filtrar resultados" id="filtros"></div>
    <span class="muted num" style="font-size:13px" id="quando"></span>
  </div>
  <section class="card tabela-box" id="lista"><p class="carregando" style="padding:16px">Verificando…</p></section>`;

const $m = (s) => main.querySelector(s);
const periodos = await listarPeriodos();
let periodoId = preencherPeriodos($m('#per'), periodos);
let itens = [], filtro = 'todos';

// Para onde ir para resolver cada tipo de problema
function destino(texto) {
  const t = texto.toLowerCase();
  if (t.includes('não está disponível')) return ['disponibilidade.html', 'Ver disponibilidade'];
  if (t.includes('aulas equivalentes') || t.includes('limite é 40')) return ['carga.html', 'Ver carga docente'];
  if (t.includes('atividade')) return ['atividades.html', 'Ver atividades'];
  if (t.includes('inativo')) return ['grade.html', 'Trocar o professor'];
  if (t.includes('pós') || t.includes('encontro') || t.includes('não letivo') || t.includes('módulo') || t.includes('fora do período')) return ['pos.html', 'Abrir planejamento da pós'];
  if (t.includes('nomes parecidos')) return ['configuracoes.html', 'Padronizar ambientes'];
  return ['grade.html', 'Abrir grade'];
}

async function verificar() {
  if (!periodoId) { $m('#lista').innerHTML = '<p class="muted" style="padding:16px">Crie um período primeiro.</p>'; return; }
  $m('#lista').innerHTML = '<p class="carregando" style="padding:16px">Verificando…</p>';
  $m('#msg').classList.add('oculto');
  try {
    const periodo = periodos.find((p) => p.id === periodoId);
    const [erros, an] = await Promise.all([rpc('auditoria', { p_periodo: periodoId }), carregarAnalise(periodo)]);
    itens = erros.map((e) => ({ tipo: 'erro', onde: '—', texto: e.problema }));
    for (const t of an.turmas) {
      const s = t.pos ? an.situacaoPos(t) : an.situacaoGrad(t);
      if (!t.pos && !s.aulas) itens.push({ tipo: 'aviso', onde: t.rotulo, texto: 'Turma sem nenhuma aula na grade.' });
      else for (const a of s.avisos) itens.push({ tipo: 'aviso', onde: t.rotulo, texto: a, pos: t.pos });
      if (t.pos && !s.ofertas) itens.push({ tipo: 'aviso', onde: t.rotulo, texto: 'Nenhum módulo planejado para esta turma de pós.', pos: true });
    }
    for (const g of an.ambParecidos) itens.push({ tipo: 'aviso', onde: 'Ambientes', texto: `Nomes parecidos: ${g.map((a) => `"${a.nome}" (${a.aulas + a.encontros} aulas)`).join(' e ')}. Podem ser o mesmo ambiente.` });
    $m('#quando').textContent = `Última verificação: ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    desenhar();
  } catch (e) { mostrarErro($m('#msg'), e); }
}

function desenhar() {
  const nE = itens.filter((i) => i.tipo === 'erro').length, nA = itens.length - nE;
  $m('#filtros').innerHTML = [['todos', `Todos (${itens.length})`], ['erro', `Erros (${nE})`], ['aviso', `Avisos (${nA})`]]
    .map(([id, r]) => `<button type="button" class="sb${filtro === id ? ' sb-on' : ''}" data-f="${id}" aria-pressed="${filtro === id}">${r}</button>`).join('');
  main.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.f; desenhar(); }));
  const lista = itens.filter((i) => filtro === 'todos' || i.tipo === filtro);
  $m('#lista').innerHTML = lista.length ? `<table style="min-width:760px">
    <thead><tr><th>Tipo</th><th>Onde</th><th style="width:55%">Problema</th><th>O que fazer</th></tr></thead>
    <tbody>${lista.map((i) => {
      const [href, rot] = i.pos ? ['pos.html', 'Abrir planejamento da pós'] : i.onde === 'Ambientes' ? ['configuracoes.html', 'Padronizar ambientes'] : i.texto.startsWith('Turma sem') || i.tipo === 'aviso' ? ['grade.html', 'Abrir grade'] : destino(i.texto);
      return `<tr><td>${i.tipo === 'erro' ? '<span class="chip chip-erro">Erro</span>' : '<span class="chip chip-aviso">Aviso</span>'}</td>
        <td>${esc(i.onde)}</td><td style="line-height:1.45">${esc(i.texto)}</td><td style="white-space:nowrap"><a href="${href}" style="font-weight:600">${rot}</a></td></tr>`;
    }).join('')}</tbody></table>`
    : `<p style="padding:20px;margin:0">${itens.length ? 'Nada neste filtro.' : '<strong>Tudo certo.</strong> Nenhum erro e nada pendente neste período.'}</p>`;
}

$m('#verificar').addEventListener('click', verificar);
$m('#per').addEventListener('change', (e) => { periodoId = e.target.value; verificar(); });
verificar();
