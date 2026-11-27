import { iniciarPagina, avisar, mostrarErro } from './pagina.js?v=202611271105';
import { sb, q } from './supabase.js?v=202611271105';
import { esc } from './util.js?v=202611271105';

// Backup (somente ADM): baixa um arquivo com todas as tabelas do sistema
const { perfil, main } = await iniciarPagina('backup');

// ordem pensada para restaurar (cadastros primeiro, depois o que depende deles)
const TABELAS = [
  ['cursos', 'Cursos'], ['matrizes', 'Matrizes'], ['componentes', 'Componentes'], ['periodos', 'Períodos'],
  ['horarios_graduacao', 'Horários da graduação'], ['horarios_pos', 'Horários da pós'], ['ambientes', 'Ambientes (salas)'],
  ['professores', 'Professores'], ['turmas', 'Turmas'], ['subturmas', 'Subturmas'], ['turma_conjuntas', 'Aulas conjuntas'],
  ['atribuicoes', 'Matéria → Professor'], ['disponibilidades', 'Disponibilidade'], ['atividades', 'Atividades complementares'],
  ['aulas', 'Aulas da graduação'], ['aula_professores', 'Professores das aulas'], ['aula_subturmas', 'Subturmas das aulas'],
  ['ofertas_pos', 'Módulos da pós'], ['encontros_pos', 'Encontros da pós'],
  ['dias_nao_letivos', 'Dias não letivos'], ['compensacoes', 'Sábados de compensação'],
];
const OPCIONAIS = [
  ['historico', 'Histórico de alterações', 'pode ser grande'],
  ['modelo_planilha', 'Modelo da planilha (confidencial)', 'arquivo Excel guardado no sistema'],
];
const CHAVE = 'horario-ultimo-backup';
const ultimo = () => { try { return localStorage.getItem(CHAVE); } catch { return null; } };

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Backup</h1>
    <p class="sub">Baixa uma cópia completa dos dados do sistema num arquivo. Guarde em local seguro (OneDrive da coordenação, por exemplo).</p></div>
  </header>
  <section class="card painel" style="max-width:760px">
    <h2>Backup completo</h2>
    <p style="margin:0;line-height:1.6">Inclui cursos, matrizes, períodos, turmas, professores, disponibilidade, atividades, a grade da graduação, a pós, dias não letivos e compensações.
      Logins e senhas <strong>não</strong> entram no arquivo.</p>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${OPCIONAIS.map(([t, n, d]) => `<label class="check"><input type="checkbox" data-opc="${t}" ${t === 'historico' ? 'checked' : ''}> ${esc(n)} <span class="muted" style="font-size:12.5px">(${esc(d)})</span></label>`).join('')}
    </div>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">
      <button type="button" class="btn btn-p" id="baixar">Baixar backup agora</button>
      <span class="muted" id="ultimo" style="font-size:13px"></span>
    </div>
    <div id="progresso" class="muted oculto" style="font-size:13px"></div>
    <div id="msg" class="oculto" role="alert"></div>
    <div class="alerta alerta-aviso" style="margin:0">
      <strong>Atenção:</strong> o arquivo tem os NIFs dos professores e todo o planejamento. Não envie por e-mail aberto nem coloque em pasta pública.
      Faça um backup antes de mudanças grandes (cópia de período, "Remover todas as aulas") e pelo menos uma vez por semana durante o planejamento.
    </div>
    <p class="muted" style="margin:0;font-size:12.5px;line-height:1.5">Para restaurar um backup, o arquivo precisa ser carregado de volta no banco por quem administra o Supabase. Os dados atuais não são apagados ao baixar.</p>
  </section>`;

const $b = (s) => main.querySelector(s);
function mostrarUltimo() {
  const u = ultimo();
  $b('#ultimo').textContent = u ? `Último backup baixado neste computador: ${new Date(u).toLocaleString('pt-BR')}` : 'Nenhum backup baixado neste computador ainda.';
}
mostrarUltimo();

// busca a tabela inteira em páginas de 1000 linhas (limite do Supabase)
async function tabelaInteira(t) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const parte = await q(sb.from(t).select('*').range(de, de + 999));
    linhas.push(...parte);
    if (parte.length < 1000) break;
  }
  return linhas;
}

$b('#baixar').addEventListener('click', async () => {
  const bt = $b('#baixar'), prog = $b('#progresso');
  bt.disabled = true; $b('#msg').classList.add('oculto'); prog.classList.remove('oculto');
  const lista = [...TABELAS, ...OPCIONAIS.filter(([t]) => $b(`[data-opc="${t}"]`).checked)];
  const dados = {}, contagem = {};
  try {
    for (const [i, [t, nome]] of lista.entries()) {
      prog.textContent = `Lendo ${nome} (${i + 1} de ${lista.length})…`;
      dados[t] = await tabelaInteira(t);
      contagem[t] = dados[t].length;
    }
    const agora = new Date();
    const arquivo = {
      sistema: 'Sistema de alocação de aula Graduação e Pós Graduação - Vila Mariana',
      versao_backup: 1, gerado_em: agora.toISOString(), gerado_por: perfil.nome, ordem_restauracao: lista.map(([t]) => t), contagem, dados,
    };
    const blob = new Blob([JSON.stringify(arquivo)], { type: 'application/json' });
    const p2 = (n) => String(n).padStart(2, '0');
    const nome = `backup-horario-${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}-${p2(agora.getHours())}${p2(agora.getMinutes())}.json`;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nome });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    try { localStorage.setItem(CHAVE, agora.toISOString()); } catch { /* ignora */ }
    mostrarUltimo();
    const total = Object.values(contagem).reduce((x, y) => x + y, 0);
    prog.textContent = `Pronto: ${total.toLocaleString('pt-BR')} registros em ${lista.length} tabelas (${(blob.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB).`;
    avisar(`Backup baixado: ${nome}`);
  } catch (e) {
    prog.classList.add('oculto');
    mostrarErro($b('#msg'), e);
  } finally { bt.disabled = false; }
});
