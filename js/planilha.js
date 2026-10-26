import { iniciarPagina, listarPeriodos, preencherPeriodos, periodoRotulo, avisar, mostrarErro } from './pagina.js';
import { sb, q } from './supabase.js';
import { esc } from './util.js';
import { gerarPlanilha } from './planilha-gerar.js';

// Exportação para Excel no modelo da coordenação (uso confidencial, só administrador).
// O modelo fica guardado no banco (tabela com acesso restrito ao ADM), nunca no repositório.
const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const ABAS_BASE = ['Nome docente', '_base_grad', '_base_pos'];

const { perfil, main } = await iniciarPagina('planilha');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Criar planilha</h1>
    <p class="sub">Exportação do planejamento para Excel no modelo da coordenação. Uso confidencial, restrito ao administrador.</p></div>
  </header>
  <div class="duas-colunas">
    <section class="card larga painel">
      <h2>Gerar planilha do período</h2>
      <div class="barra" style="padding:0;align-items:flex-end">
        <div class="campo" style="flex:0 1 180px"><label for="per">Período letivo</label><select id="per"></select></div>
        <button class="btn btn-p" id="gerar" type="button">Gerar planilha</button>
      </div>
      <p class="muted" style="margin:0;font-size:13px;line-height:1.55">A planilha traz uma aba por professor com aulas ou atividades no período, o horário da graduação por curso,
      o horário de cada turma de pós e as abas de RH em branco. Titulação, admissão, cargo e Lattes ficam em branco para preencher no Excel.</p>
      <div id="msg" class="oculto" role="alert"></div>
      <div id="resultado"></div>
    </section>
    <aside class="card estreita painel" id="modelo"><p class="carregando">Carregando…</p></aside>
  </div>
  <input type="file" id="arquivo" accept=".xlsx" hidden>`;

const $m = (s) => main.querySelector(s);
const periodos = await listarPeriodos();
let periodoId = preencherPeriodos($m('#per'), periodos);
$m('#per').addEventListener('change', (e) => { periodoId = e.target.value; $m('#resultado').innerHTML = ''; });
if (!periodoId) $m('#gerar').disabled = true;

// ---------- ExcelJS sob demanda ----------
let carregandoExcel = null;
function excel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  carregandoExcel ||= new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = EXCELJS_URL; s.async = true;
    s.onload = () => ok(window.ExcelJS);
    s.onerror = () => { carregandoExcel = null; falha(new Error('Não foi possível carregar o gerador de Excel. Verifique a internet e tente de novo.')); };
    document.head.appendChild(s);
  });
  return carregandoExcel;
}

const paraBase64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const deBase64 = (txt) => { const s = atob(txt); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; };
const dataHora = (v) => new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// ---------- modelo guardado ----------
let modeloInfo = null;
async function carregarModelo() {
  const [m] = await q(sb.from('modelo_planilha').select('nome_arquivo, tamanho, atualizado_em, atualizado_por').eq('id', 1));
  modeloInfo = m || null;
  $m('#modelo').innerHTML = `
    <h2>Modelo da planilha</h2>
    ${m ? `<div style="display:flex;flex-direction:column;gap:4px;font-size:13.5px">
        <span><strong>${esc(m.nome_arquivo)}</strong></span>
        <span class="muted">${(m.tamanho / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB · enviado em ${dataHora(m.atualizado_em)}</span></div>`
      : '<div class="alerta alerta-aviso">Nenhum modelo enviado ainda. Envie o arquivo de modelo preparado para o sistema.</div>'}
    <button class="btn" id="enviar" type="button">${m ? 'Trocar modelo' : 'Enviar modelo'}</button>
    <p class="muted" style="margin:0;font-size:12.5px;line-height:1.5">O modelo fica guardado só no banco de dados, com acesso apenas do administrador. Ele precisa ter as abas
    "Nome docente", "_base_grad" e "_base_pos", que servem de base para as abas geradas.</p>`;
  $m('#enviar').addEventListener('click', () => $m('#arquivo').click());
  $m('#gerar').disabled = !periodoId || !m;
}

$m('#arquivo').addEventListener('change', async (ev) => {
  const arq = ev.target.files[0];
  ev.target.value = '';
  if (!arq) return;
  const msg = $m('#msg');
  msg.classList.add('oculto');
  try {
    if (arq.size > 5 * 1024 * 1024) throw new Error('O arquivo passa de 5 MB. Confira se é o modelo certo.');
    const buf = await arq.arrayBuffer();
    const ExcelJS = await excel();
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { throw new Error('Não consegui abrir o arquivo. Envie um .xlsx válido.'); }
    const faltam = ABAS_BASE.filter((n) => !wb.getWorksheet(n));
    if (faltam.length) throw new Error(`O arquivo não tem as abas base: ${faltam.join(', ')}.`);
    const dados = { id: 1, nome_arquivo: arq.name, conteudo_base64: paraBase64(buf), tamanho: arq.size, atualizado_em: new Date().toISOString(), atualizado_por: perfil.professor_id || null };
    await q(sb.from('modelo_planilha').upsert(dados));
    avisar('Modelo guardado.');
    await carregarModelo();
  } catch (e) { mostrarErro(msg, e); }
});

// ---------- dados do período ----------
async function dadosDoPeriodo(periodo) {
  const turmas = await q(sb.from('turmas').select('id, matriz_id, semestre, identificacao, subturmas(id, nome)').eq('periodo_id', periodo.id));
  const [cursos, matrizes, componentes, aulas, encontros, ofertas, horarios, professores, atividades] = await Promise.all([
    q(sb.from('cursos').select('id, nome, sigla, nivel')),
    q(sb.from('matrizes').select('id, curso_id')),
    q(sb.from('componentes').select('id, matriz_id, nome, sigla, modalidade, carga, ordem, semestre, ativo')),
    q(sb.from('v_aulas_horario').select('*').eq('periodo_id', periodo.id)),
    q(sb.from('v_encontros').select('*').eq('periodo_id', periodo.id)),
    turmas.length ? q(sb.from('ofertas_pos').select('id, turma_id, componente_id, professor_id, modo, formato').in('turma_id', turmas.map((t) => t.id))) : [],
    q(sb.from('horarios_graduacao').select('tipo_dia, numero, inicio, fim')),
    q(sb.from('professores').select('id, nome, nif, ativo')),
    q(sb.from('atividades').select('professor_id, descricao, quantidade, frequencia, tipo, observacao').eq('periodo_id', periodo.id)),
  ]);
  const ids = aulas.map((a) => a.id);
  const [ap, as, ambientes] = await Promise.all([
    ids.length ? q(sb.from('aula_professores').select('aula_id, professor_id').in('aula_id', ids)) : [],
    ids.length ? q(sb.from('aula_subturmas').select('aula_id, subturma_id').in('aula_id', ids)) : [],
    q(sb.from('ambientes').select('id, nome')),
  ]);
  const amb = new Map(ambientes.map((a) => [a.id, a.nome]));
  return {
    periodo,
    cursos, matrizes, componentes, horarios, professores, atividades,
    turmas: turmas.map((t) => ({ ...t, subturmas: t.subturmas || [] })),
    aulas: aulas.map((a) => ({
      turma_id: a.turma_id, componente_id: a.componente_id, dia_semana: a.dia_semana, inicio: a.inicio, quantidade: a.quantidade,
      ambiente: amb.get(a.ambiente_id) || null,
      professores: ap.filter((x) => x.aula_id === a.id).map((x) => x.professor_id),
      subturmas: as.filter((x) => x.aula_id === a.id).map((x) => x.subturma_id),
    })),
    ofertas: ofertas.map((o) => ({
      ...o,
      encontros: encontros.filter((e) => e.oferta_id === o.id).map((e) => ({ data: e.data, inicio: e.inicio, fim: e.fim, minutos: e.minutos, ambiente: amb.get(e.ambiente_id) || null }))
        .sort((a, b) => a.data.localeCompare(b.data)),
    })),
  };
}

// ---------- gerar ----------
$m('#gerar').addEventListener('click', async () => {
  const btn = $m('#gerar'), msg = $m('#msg'), res = $m('#resultado');
  const periodo = periodos.find((p) => p.id === periodoId);
  msg.classList.add('oculto');
  btn.disabled = true; btn.textContent = 'Gerando…';
  res.innerHTML = '<p class="carregando">Montando a planilha…</p>';
  try {
    const [ExcelJS, [modelo], dados] = await Promise.all([
      excel(),
      q(sb.from('modelo_planilha').select('conteudo_base64').eq('id', 1)),
      dadosDoPeriodo(periodo),
    ]);
    if (!modelo) throw new Error('Envie o modelo da planilha antes de gerar.');
    const { buffer, avisos, resumo } = await gerarPlanilha(ExcelJS, deBase64(modelo.conteudo_base64), dados);
    const nome = `Alocacao_docente_${periodo.ano}-${periodo.semestre}.xlsx`;
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: nome });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    res.innerHTML = `
      <div class="alerta alerta-ok">Planilha ${esc(periodoRotulo(periodo))} gerada: <strong>${esc(nome)}</strong>. <a href="${url}" download="${esc(nome)}">Baixar de novo</a></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;font-size:13.5px">
        <div class="card kpi"><span class="kl">Abas de professor</span><span class="kv num">${resumo.professores}</span></div>
        <div class="card kpi"><span class="kl">Horário graduação</span><span class="kv num">${resumo.graduacao.length}</span><span class="kd">${esc(resumo.graduacao.join(', ') || '—')}</span></div>
        <div class="card kpi"><span class="kl">Horário pós</span><span class="kv num">${resumo.pos.length}</span><span class="kd">${esc(resumo.pos.join(', ') || '—')}</span></div>
      </div>
      <p class="muted" style="margin:0;font-size:12.5px">Colunas de mês: ${esc(resumo.meses.join(' · '))}</p>
      ${avisos.length ? `<div class="alerta alerta-aviso"><strong>Confira antes de enviar (${avisos.length})</strong><ul style="margin:6px 0 0;padding-left:18px">${avisos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`;
  } catch (e) { res.innerHTML = ''; mostrarErro(msg, e); }
  finally { btn.disabled = false; btn.textContent = 'Gerar planilha'; }
});

carregarModelo().catch((e) => mostrarErro($m('#msg'), e));
