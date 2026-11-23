# Sistema de alocação de aula Graduação e Pós-Graduação · Vila Mariana

Documentação de regras de negócio, banco de dados, telas e funções.
Atualizada em 22/11/2026.

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Arquitetura e segurança](#2-arquitetura-e-segurança)
3. [Regras de negócio](#3-regras-de-negócio)
4. [Banco de dados: tabelas](#4-banco-de-dados-tabelas)
5. [Banco de dados: views, gatilhos e armazenamento](#5-banco-de-dados-views-gatilhos-e-armazenamento)
6. [Banco de dados: funções](#6-banco-de-dados-funções)
7. [Telas](#7-telas)
8. [Arquivos de código do site](#8-arquivos-de-código-do-site)
9. [Funções de servidor (Edge Functions)](#9-funções-de-servidor-edge-functions)
10. [Planilha da coordenação (Criar planilha)](#10-planilha-da-coordenação-criar-planilha)
11. [Operação e manutenção](#11-operação-e-manutenção)

---

## 1. Visão geral

Sistema da Escola SENAI Vila Mariana para:

- montar o horário da **graduação** (aulas noturnas de 50 minutos e aulas de sábado) e planejar os encontros da **pós-graduação**;
- calcular a **carga docente** semanal de cada professor, com o limite de 40 aulas equivalentes;
- impedir conflitos de professor, turma e sala;
- mostrar a cada professor **somente as suas aulas**;
- gerar a **planilha confidencial da coordenação** em Excel, os relatórios e o histórico de alterações.

**Perfis**

| Perfil | Quem é | O que faz |
|---|---|---|
| ADM | coordenação | Acessa tudo. Pode promover professores a ADM. |
| Professor | docente | Vê só **Minhas aulas** dos períodos liberados, o calendário escolar e os dias letivos. |

O ADM também é professor (tem NIF e pode ter aulas). O perfil é descoberto no login.

---

## 2. Arquitetura e segurança

| Parte | Tecnologia |
|---|---|
| Site | Páginas estáticas no **GitHub Pages** (repositório `bettux/horario`), em HTML, CSS e JavaScript puro com módulos ES |
| Banco e login | **Supabase** (projeto `alocacao-docente`): Postgres, Auth, Storage, Realtime e Edge Functions |
| Biblioteca do banco | `@supabase/supabase-js@2.45.4` via esm.sh |
| Excel | ExcelJS 4.4.0 (cdn.jsdelivr), carregado só ao gerar a planilha |

**Login**

- O login é feito pelo **NIF**. Internamente, o e-mail é `NIF@horario.local`; não existe login por e-mail real.
- **Senha provisória:** NIF + `cfp109`, válida por **7 dias**. A troca é obrigatória no primeiro acesso, e "redefinir senha" volta para o mesmo padrão.
- **Senha nova:** pelo menos 8 caracteres, com letras e números, e sem conter o NIF.
- Não há cadastro aberto: só o ADM cria acessos.

**Segurança no banco (RLS)**

- Todas as tabelas têm RLS forçado.
- Só o ADM, conferido por `is_admin()`, tem acesso direto às tabelas.
- O professor só lê dados por funções `SECURITY DEFINER` presas ao próprio usuário: `meu_perfil`, `meus_periodos`, `minhas_aulas` e `dias_letivos`.
- Enquanto a senha provisória não for trocada, `troca_senha_pendente()` bloqueia as funções do professor.
- A chave `service_role` fica **somente** na Edge Function, nunca no site.
- O site usa apenas a chave pública (publishable).

**Backup do sistema antigo:** ramo `versao-1` no GitHub.

---

## 3. Regras de negócio

### 3.1 Períodos letivos

- Cada período tem ano, semestre (1 ou 2), início, fim e **semanas letivas**. O padrão é 20 semanas, e o número é usado no cálculo da carga e da quantidade de aulas por semana.
- **Visível para professores:** o professor só enxerga os períodos marcados, e a trava também está no banco. Período novo começa **oculto**. O ADM vê todos.
- **Calendário escolar em PDF:** um arquivo por período, privado, que só usuários logados baixam.

### 3.2 Horários

- **Graduação, dias de semana:** 5 aulas de 50 minutos: 18:25, 19:15, 20:20, 21:10 e 22:00 (até 22:50).
- **Graduação, sábado:** 8 aulas: 09:00, 09:50, 10:55, 11:45, 13:00, 13:50, 14:40 e 15:45 (até 17:25). O sábado é usado por EAD e Extensão.
- **Pós, durante a semana:** turma de 10 semanas das 19:00 às 22:00 (3 h); turma de 8 semanas das 19:00 às 22:45 (3h45).
- **Pós, sábado:** manhã das 08:00 às 12:00 e tarde das 13:00 às 17:00 (3h45 de aula + 15 min de intervalo cada), ou integral.
- Os modos Semana e Sábado da pós são independentes.

### 3.3 Turmas, subturmas e aulas conjuntas

- A turma pertence a um período, a uma matriz e a um semestre. A **identificação** é o código da turma, por exemplo `CTSADS226N1`.
- A turma tem subturmas (T1, T2…). Toda aula precisa indicar para quais subturmas é.
- **T1 e T2 são separadas por padrão.** A quantidade de **aulas conjuntas por semana** (T1+T2 juntas) é definida **por turma, em cada semestre**, em Gestão de turmas > Professores (tabela `turma_conjuntas`). Ela não fica na matriz.
- Uma subturma não pode ter duas aulas ao mesmo tempo.

### 3.4 Componentes (matérias) e carga

- **Modalidade:** presencial, EAD síncrona, EAD assíncrona, pós ou TCC. Só presencial e EAD síncrona ocupam horário na grade.
- **Professor:**
  - obrigatório: a aula precisa de professor;
  - opcional: pode ficar sem professor;
  - sem: não leva professor.
- **Aulas por semana de uma matéria:** carga do semestre ÷ semanas letivas, arredondado para cima.
- **Carga completa:** a soma das aulas da subturma × semanas letivas não pode passar da carga da matriz.
- **Sigla:** gerada pelas iniciais do nome (ex.: BD, PII I) e editável. Aparece nos blocos da grade e na planilha.

### 3.5 Projeto Integrador e Extensão (regra `pi_extensao`)

- **Até 2 aulas por semana para cada componente, em cada subturma.** O limite é de cada um separadamente: PI e Extensão não se somam.
- Não precisam completar a carga, porque ela é cumprida fora da grade.
- **Projeto Integrador:** professor opcional e livre. Cada aula pode ter um professor diferente (normalmente 1 aula por professor).
- **Extensão Universitária:** pode ir em **qualquer dia e horário**, mesmo fora da disponibilidade do professor. Os choques, a sala, o limite de 40 e o bloqueio do dia de pós continuam valendo.

### 3.6 Professores

- Cadastro com nome, NIF (único), cor (paleta de 36 cores, com sugestão automática de uma cor livre), ativo e perfil.
- **Disponibilidade por período:** dias e faixas de horário. Dia desmarcado significa indisponível.
- **Matéria → Professor** (`atribuicoes`): por subturma e por semestre. Alimenta a faixa "Faltam", o lançamento direto, o preenchimento automático e a carga da EAD assíncrona.
- **Excluir professor:** botão no cadastro. Só exclui quem **não tem aulas nem módulos de pós no período ativo ou em períodos futuros**; quem tem aulas em períodos encerrados deve ser inativado, para preservar o histórico. A confirmação exige digitar o NIF. Junto são apagados a disponibilidade, as atividades, as indicações em Matéria → Professor e o login. Ninguém exclui o próprio cadastro nem o último ADM.
- **Proteção dos ADMs:** ninguém pode se rebaixar ou se desativar, e o último ADM não pode ser removido nem rebaixado.

### 3.7 Conflitos e validações

Toda gravação passa por estas funções do banco. Qualquer erro **impede a gravação** e mostra o motivo. Nas gravações por aula, só bloqueia problema **novo**: um problema que já existia antes não trava uma ação sem relação com ele.

| Regra | Onde é conferida |
|---|---|
| Professor em duas aulas ao mesmo tempo (graduação × graduação, pós × pós) | `validar_professor` |
| **Pós bloqueia o dia inteiro** para a graduação daquele professor | `validar_professor` |
| Fora da disponibilidade do professor (exceto Extensão) | `validar_professor` |
| Mais de **40 aulas equivalentes** numa semana | `validar_professor` |
| Professor inativo com aula | `validar_professor` |
| Atividade semanal para professor sem aulas no período | `validar_professor` |
| Matéria fora da matriz ou semestre da turma; modalidade que não ocupa horário; horário inválido | `validar_turma` |
| Matéria obrigatória sem professor; matéria "sem professor" com professor; mais de 2 professores | `validar_turma` |
| Subturma com duas aulas ao mesmo tempo; aula sem subturma | `validar_turma` |
| Carga acima da matriz; PI ou Extensão com mais de 2 por semana | `validar_turma` |
| Mesmo **ambiente** no mesmo dia e horário (graduação e pós) | `validar_ambientes` |
| Regras da pós (datas, módulos, formato) | `validar_turma_pos` |

### 3.8 Carga docente (igual à planilha da coordenação)

```
G   = aulas de graduação na semana (sem Extensão) + metade das EAD assíncronas
X   = aulas de Extensão na semana
P50 = arredondar para cima (minutos de pós na semana ÷ 50)
Preparação = arredondar para cima (G × 20%) + arredondar para cima (P50 × 10%)
Ensino     = G + X + P50 + Preparação
Total      = Ensino + atividades semanais          → limite: 40
```

- **Extensão não recebe preparação.**
- **EAD assíncrona:** o professor definido na lista Matéria → Professor recebe (carga ÷ semanas letivas) ÷ 2 por semana, uma vez por turma.
- **Atividades complementares:**
  - só as **semanais** entram na carga; as "por período" ficam só como registro;
  - o **tipo** indica a linha da planilha: estágio, extensão, IC/orientação, coordenação de curso, pesquisa CNPq, distrito ou outras.
- **Para o professor:** os cards mostram a semana mais cheia do período, sem o detalhe dos percentuais.

### 3.9 Dias não letivos, reposições, compensações e dias letivos

- **Dia não letivo:** a pós pula a data automaticamente. A graduação não desconta.
- **Reposição no sábado:** o dia não letivo pode indicar o sábado em que as aulas daquele dia da semana serão repostas. Vale para todas as turmas de graduação; a pós fica de fora.
  - A data precisa ser um sábado.
  - Precisa estar dentro do período.
  - Não pode ser um dia não letivo.
  - Não pode já estar em uso por outra reposição ou compensação.
- **Sábado de compensação (sem feriado):** um sábado que vale como um dia da semana, usado quando o calendário tem menos semanas. As mesmas regras de data valem aqui.
- **Dias letivos:** tabela de segunda a sexta com as datas do período, sem os dias não letivos e com os sábados de reposição e de compensação na coluna do dia que eles valem.
  - O ADM vê uma conferência do tipo "Seg 19 de 20".
  - O professor recebe os avisos dos sábados que o afetam.

### 3.10 Montar horário (tela principal)

- Abre todas as turmas de graduação do curso no período, uma embaixo da outra.
- **Lançar uma aula:**
  - arrastando um **professor** ou uma etiqueta da faixa **"Faltam"**;
  - **lançamento direto:** quando o professor tem uma só matéria pendente naquela subturma, a aula entra sem janela;
  - nos outros casos abre a janela de lançamento.
- **Ajustar:**
  - mover arrastando o bloco;
  - 2º professor: soltar um professor em cima da aula;
  - lixeira para remover;
  - clicar no bloco para editar;
  - "Remover todas as aulas" da turma.
- **Durante o arraste,** os horários impossíveis ficam hachurados, com o motivo.
- **Desfazer:** botão e Ctrl+Z, até 30 ações da sessão.
- **Destacar professor:** clique no nome no painel.
- **Tempo real e presença** entre os coordenadores.
- **Toque:** segurar e arrastar, no tablet e no celular.

### 3.11 Preenchimento automático

1. Gera as demandas pelo que falta em cada turma, usando a lista Matéria → Professor. As **aulas conjuntas** saem na quantidade marcada para a turma; o resto vai separado por subturma.
2. **Ordem:** conjuntas primeiro; depois as matérias com menos opções de horário; depois as maiores.
3. **Respeita:**
   - a disponibilidade do professor (exceto Extensão);
   - os dias de pós;
   - os choques com qualquer turma do período;
   - uma estimativa do limite de 40.
4. **Tenta o bloco inteiro num dia**; só divide quando não cabe. Prefere o dia com menos aulas na turma.
5. **Onde cada tipo vai:**
   - presencial: segunda a sexta;
   - EAD síncrona e Extensão: sábado primeiro;
   - Projeto Integrador sem professor definido não é encaixado (o sistema pede para escolher arrastando).
6. **O resultado é uma proposta tracejada**, que pode ser movida, retirada ou receber um 2º professor antes de **"Aceitar e gravar"**.
7. **Ao gravar,** cada bloco passa pelas regras do banco; os recusados aparecem com o motivo.
8. **Desfazer** remove tudo o que o preenchimento gravou.
9. **Não mexe no que já está lançado.**

### 3.12 Cópia de período

"Copiar de outro período" traz:

- as turmas de graduação (mesmo curso, semestre e identificação) e as subturmas;
- a lista Matéria → Professor (ou o 1º professor da grade de origem) e as aulas conjuntas;
- opcionalmente, a disponibilidade dos professores e a grade.

Nada que já existe no destino é apagado. A grade só vai para turmas vazias. Se a grade copiada quebrar alguma regra, nada é gravado. A pós não é copiada.

### 3.13 Histórico

O banco registra sozinho quem alterou o quê e quando, com o antes e o depois:

- grade, pós, disponibilidade, Matéria → Professor e cópia de período;
- turmas, subturmas, períodos, dias não letivos, compensações, professores, atividades e componentes.

Salvar sem mudança não gera registro.

---

## 4. Banco de dados: tabelas

`*` = obrigatório. Todas têm RLS com a política `adm_total` (acesso só do ADM), salvo indicação.

### Cadastro acadêmico

| Tabela | Colunas | Observações |
|---|---|---|
| `cursos` | id*, nome*, sigla, nivel* (`graduacao`, `pos`), ativo* | |
| `matrizes` | id*, curso_id*, nome*, vigente* | PPC do curso |
| `componentes` | id*, matriz_id*, semestre* (0 = pós), ordem*, nome*, modalidade* (`presencial`, `ead_sincrona`, `ead_assincrona`, `pos`, `tcc`), carga, regra* (`normal`, `pi_extensao`), professor* (`obrigatorio`, `opcional`, `sem`), ativo*, sigla, aulas_conjuntas* | `aulas_conjuntas` ficou **sem uso** (substituída por `turma_conjuntas`). A sigla é preenchida por gatilho quando vem vazia. |
| `periodos` | id*, ano*, semestre* (1 ou 2), inicio*, fim*, semanas_letivas* (1–30, padrão 20), visivel_professor*, calendario_em | |
| `turmas` | id*, periodo_id*, matriz_id*, semestre*, identificacao* | Código da turma |
| `subturmas` | id*, turma_id*, nome* | T1, T2… |
| `turma_conjuntas` | turma_id*, componente_id*, aulas* (1–10) | Aulas conjuntas por semana, por turma e semestre |
| `ambientes` | id*, nome*, chave (gerada, única) | Criados na hora; nomes parecidos podem ser unidos |

### Horários

| Tabela | Colunas |
|---|---|
| `horarios_graduacao` | tipo_dia* (`semana`, `sabado`), numero*, inicio*, fim* |
| `horarios_pos` | formato* (`10_semanas`, `8_semanas`, `manha`, `tarde`), inicio*, fim*, minutos_aula* |

### Professores

| Tabela | Colunas | Observações |
|---|---|---|
| `professores` | id*, nome*, nif* (3–12 dígitos, único), cor* (#RRGGBB), ativo*, perfil* (`professor`, `adm`), auth_user_id | Gatilho `proteger_adms` |
| `disponibilidades` | professor_id*, periodo_id*, dia_semana* (1–6), inicio*, fim* | Dia sem registro = indisponível |
| `atividades` | id*, professor_id*, periodo_id*, descricao*, quantidade* (> 0), frequencia* (`semanal`, `periodo`), observacao, tipo* (`estagio`, `extensao`, `ic_orientacao`, `coordenacao_curso`, `pesquisa_cnpq`, `distrito`, `outras`) | |
| `atribuicoes` | subturma_id*, componente_id*, professor_id*, atualizado_em* | Matéria → Professor (chave subturma + componente) |

### Graduação

| Tabela | Colunas | Observações |
|---|---|---|
| `aulas` | id*, turma_id*, componente_id*, dia_semana* (1–6), inicio* (nº do horário), quantidade* (1–8), ambiente_id, atualizado_em* | Uma aula ocupa `quantidade` horários seguidos |
| `aula_professores` | aula_id*, professor_id* | Até 2 |
| `aula_subturmas` | aula_id*, subturma_id* | Mais de uma = aula conjunta |

### Pós-graduação

| Tabela | Colunas | Observações |
|---|---|---|
| `ofertas_pos` | id*, turma_id*, componente_id*, professor_id*, modo* (`semana`, `sabado`), formato* (semana: `10_semanas` ou `8_semanas`; sábado: `manha`, `tarde` ou `integral`) | Única por turma + componente + modo |
| `encontros_pos` | id*, oferta_id*, data*, inicio*, fim*, minutos*, ambiente_id | Datas já sem os dias não letivos |

### Calendário

| Tabela | Colunas | Observações |
|---|---|---|
| `dias_nao_letivos` | id*, periodo_id*, data*, motivo*, reposicao_em | Gatilho `validar_reposicao` |
| `compensacoes` | id*, periodo_id*, data* (sábado), dia_semana* (1–5), motivo | Gatilho `validar_compensacao`; única por período + data |

### Sistema

| Tabela | Colunas | Observações |
|---|---|---|
| `historico` | id*, em*, usuario, periodo_id, tipo*, acao*, alvo, antes, depois | Só leitura para o ADM; gravada pelas funções e pelos gatilhos |
| `modelo_planilha` | id* (= 1), nome_arquivo*, conteudo_base64*, tamanho*, atualizado_em*, atualizado_por | Modelo confidencial da planilha; **nunca** vai para o GitHub |

---

## 5. Banco de dados: views, gatilhos e armazenamento

### Views (todas `security_invoker`)

| View | Para quê |
|---|---|
| `v_aulas_horario` | Aula com período, nome da matéria e horário real de início e fim (hi, hf) |
| `v_encontros` | Encontro de pós com turma, período, componente, professor e dia da semana |
| `v_ambientes_uso` | Quantas aulas e encontros usam cada ambiente |
| `v_dias_nao_letivos` | Dia não letivo com a contagem de encontros afetados e a reposição |
| `v_historico` | Histórico com o nome de quem alterou |

### Gatilhos

| Tabela | Gatilho | Função |
|---|---|---|
| `componentes` | `componentes_sigla` | `componentes_sigla_padrao`: gera e normaliza a sigla |
| `professores` | `trg_proteger_adms` | `proteger_adms` |
| `dias_nao_letivos` | `dias_nao_letivos_reposicao` | `validar_reposicao` |
| `compensacoes` | `compensacoes_validar` | `validar_compensacao` |
| turmas, subturmas, periodos, dias_nao_letivos, compensacoes, professores, atividades, componentes | `historico` | `historico_linha` (pode ser silenciado pela cópia de período) |

### Armazenamento (Supabase Storage)

- **Balde `calendarios`:** privado, só PDF, até 10 MB. O arquivo tem o nome `<periodo_id>.pdf`.
- **Leitura:** pela função `calendario_liberado(nome)`: o ADM sempre, e o professor só se o período estiver visível.
- **Envio, troca e remoção:** só o ADM.

### Tempo real

A publicação `supabase_realtime` inclui `aulas`, `aula_professores`, `aula_subturmas` e `atribuicoes`. O RLS continua valendo, então só o ADM recebe os eventos.

---

## 6. Banco de dados: funções

**invoker** roda com as permissões de quem chama. **definer** roda com permissão elevada, mas sempre presa ao usuário logado.

### Segurança e perfil

| Função | Tipo | O que faz |
|---|---|---|
| `is_admin()` | definer | O usuário logado é ADM ativo? |
| `professor_atual()` | definer | id do professor do usuário logado |
| `troca_senha_pendente()` | invoker | Lê `app_metadata.troca_senha_pendente` do token |
| `periodo_liberado(periodo)` | definer | ADM ou professor com o período visível |
| `meu_perfil()` | definer | Nome, NIF, perfil, ativo e troca pendente |
| `meus_periodos()` | definer | Períodos visíveis (todos para o ADM), com `tem_calendario` |
| `minhas_aulas(periodo)` | definer | Graduação, pós, carga e atividades do professor logado |
| `agenda_professor(prof, periodo)` | definer | O mesmo, para o ADM consultar qualquer professor |
| `_aulas_professor(prof, periodo)` | definer | Base interna das duas anteriores |
| `dias_letivos(periodo)` | definer | Dias letivos com o tipo: normal, reposição ou compensação |
| `calendario_liberado(nome)` | definer | Regra de leitura do PDF |
| `listar_acessos()` | definer | ADM: situação de login de cada professor |

### Gravação (todas exigem ADM e travam o período durante a gravação)

| Função | O que faz |
|---|---|
| `gravar_aula(aula, turma, componente, dia, inicio, quantidade, subturmas[], professores[], ambiente)` | Lança (aula nula) ou altera **uma** aula. Bloqueia só problemas novos e registra no histórico. |
| `remover_aula(aula)` | Remove uma aula e registra no histórico |
| `limpar_turma(turma)` | Remove todas as aulas da turma, mantém a lista Matéria → Professor e registra no histórico |
| `salvar_grade_turma(turma, aulas jsonb)` | Substitui a grade inteira da turma (era usada pela tela antiga, removida em 22/11/2026; mantida no banco) |
| `salvar_oferta_pos(turma, componente, modo, professor, formato, encontros jsonb)` | Grava um módulo da pós e os encontros dele; sem encontros, remove |
| `salvar_disponibilidade(prof, periodo, dias jsonb)` | Substitui a disponibilidade do professor no período |
| `salvar_atividade(id, prof, periodo, descricao, quantidade, frequencia, observacao, tipo)` | Cria ou altera uma atividade complementar |
| `salvar_atribuicoes(turma, itens jsonb)` | Substitui a lista Matéria → Professor da turma |
| `copiar_periodo(origem, destino, disponibilidades, aulas)` | Cópia de período (ver 3.12) |
| `exclusao_professor(prof)` | Lista o que impede a exclusão e o que será apagado junto |
| `excluir_professor(prof)` | Exclui o professor (só sem impedimentos) e devolve o login para a Edge Function apagar |
| `juntar_ambientes(origem, destino)` | Une dois ambientes (nomes parecidos) |
| `ambiente_id(nome)` | Acha ou cria o ambiente pelo nome |

### Validação

| Função | O que confere |
|---|---|
| `validar_professor(prof, periodo)` | Choques, pós no dia, disponibilidade (exceto Extensão), limite de 40, professor inativo, atividade sem aula |
| `validar_turma(turma)` | Matriz e semestre, modalidade, horário, professor, subturmas, choque na subturma, carga, PI e Extensão até 2 |
| `validar_turma_pos(turma)` | Regras da turma de pós |
| `validar_ambientes(periodo, turma?)` | Ambiente ocupado (graduação e pós) |
| `_problemas_escopo(turma, periodo, profs[])` | Junta as validações acima para comparar antes e depois |
| `_falhar_se_erros(erros[])` | Cancela a gravação com o erro `P0001` e uma linha por problema |
| `auditoria(periodo)` | Todos os problemas do período (tela Auditoria) |

### Carga

| Função | O que faz |
|---|---|
| `calc_carga(g, pos_min, ativ, ext)` | Fórmula da seção 3.8 |
| `carga_semana(prof, periodo, segunda)` | Carga de uma semana, incluindo meia EAD assíncrona |
| `carga_periodo(prof, periodo)` | Carga de todas as semanas do período |
| `carga_todos(periodo)` | Carga de todos os professores (Dashboard, Carga docente, Montar horário) |
| `semanas_periodo(periodo)` | Semanas letivas do período |

### Apoio e histórico

| Função | O que faz |
|---|---|
| `turma_rotulo(turma)` | Rótulo, por exemplo "ADS · 1º sem. · CTSADS127N1" |
| `dia_nome(dia)`, `aula_horario(dia, inicio, qtd)`, `fmt_num(n)` | Formatação e cálculo de horário |
| `e_extensao(nome)`, `gerar_sigla(nome)` | Identifica Extensão; gera a sigla |
| `_registrar(...)`, `historico_linha()` | Gravam o histórico (só quando algo muda) |
| `_snap_grade`, `_snap_oferta`, `_snap_disp`, `_snap_atrib` | Retratos legíveis do "antes" e do "depois" |
| `validar_reposicao()`, `validar_compensacao()`, `proteger_adms()`, `componentes_sigla_padrao()` | Funções dos gatilhos |

---

## 7. Telas

**Menu do ADM:** Dashboard · Planejamento (Montar horário, Planejamento da pós, Carga docente) · Professores (Cadastro, Disponibilidade, Atividades complementares, Agenda docente) · Gestão acadêmica (Gestão de turmas, Matrizes curriculares, Configurações acadêmicas) · Auditoria · Histórico de alterações · Relatórios de aulas · Criar planilha · Usuários e acessos · Minhas aulas · Sair.

**Menu do professor:** Minhas aulas · Sair.

Em telas largas e no celular, o menu vira **sanduíche (☰)**.

| Tela (arquivo) | Quem | O que faz | Principais chamadas |
|---|---|---|---|
| Login (`index.html`) | todos | Login por NIF e senha; leva ao perfil certo | Auth, `meu_perfil` |
| Primeiro acesso (`primeiro-acesso.html`) | todos | Troca obrigatória da senha provisória | Edge `gerenciar-usuarios` (`trocar_senha`) |
| Dashboard (`inicio.html`) | ADM | Indicadores do período, andamento por turma e aulas de todos os professores | `carga_todos`, `auditoria` |
| **Montar horário** (`montar.html`) | ADM | Tela principal da grade (3.10 e 3.11) | `gravar_aula`, `remover_aula`, `limpar_turma`, `carga_todos`, Realtime |
| Planejamento da pós (`pos.html`) | ADM | Módulos e encontros por turma, nos modos Semana e Sábado, pulando dias não letivos | `salvar_oferta_pos` |
| Carga docente (`carga.html`) | ADM | Carga semana a semana de todos, com o detalhe do cálculo | `carga_todos` |
| Cadastro de professores (`professores.html`) | ADM | Nome, NIF, cor (36 cores), ativo, perfil; criar acesso; excluir professor | tabela `professores`, `exclusao_professor`, Edge `criar_acesso` e `excluir_professor` |
| Disponibilidade (`disponibilidade.html`) | ADM | Dias e horários por período | `salvar_disponibilidade` |
| Atividades complementares (`atividades.html`) | ADM | Atividades com tipo e frequência | `salvar_atividade` |
| Agenda docente (`agenda.html`) | ADM | Semana de qualquer professor | `agenda_professor` |
| Gestão de turmas (`turmas.html`) | ADM | Turmas e subturmas; **Professores** (Matéria → Professor e aulas conjuntas); **Copiar de outro período** | `salvar_atribuicoes`, `turma_conjuntas`, `copiar_periodo` |
| Matrizes curriculares (`matrizes.html`) | ADM | Cursos, matrizes e componentes (sigla, modalidade, carga, regra, professor) | tabelas `cursos`, `matrizes` e `componentes` |
| Configurações acadêmicas (`configuracoes.html`) | ADM | Períodos (semanas, visível, calendário em PDF), dias não letivos, reposição, sábados de compensação, conferência de dias letivos, horários, ambientes | tabelas, Storage, `dias_letivos`, `juntar_ambientes` |
| Auditoria (`auditoria.html`) | ADM | Lista os problemas do período | `auditoria` |
| Histórico de alterações (`historico.html`) | ADM | Quem mudou o quê e quando, com filtros | `v_historico` |
| Relatórios de aulas (`relatorios.html`) | ADM | Por professor ou por turma; impressão e PDF em A4 paisagem | tabelas e views, `carga_todos` |
| Criar planilha (`planilha.html`) | ADM | Envia o modelo e gera o Excel da coordenação | `modelo_planilha`, ExcelJS |
| Usuários e acessos (`usuarios.html`) | ADM | Criar acesso, redefinir senha, bloquear e reativar, promover a ADM | `listar_acessos`, Edge `gerenciar-usuarios` |
| **Minhas aulas** (`minhas-aulas.html`) | professor e ADM | Só o período: cards de carga, grade fixa, pós, sábados letivos, atividades, botões **Calendário escolar** e **Dias letivos** | `meus_periodos`, `minhas_aulas`, `dias_letivos`, Storage |

---

## 8. Arquivos de código do site

| Arquivo | Papel |
|---|---|
| `js/config.js` | URL do Supabase, chave pública, domínio do login e título |
| `js/supabase.js` | Cliente, `rpc()`, `q()` e mensagens de erro em português (`linhas` vem do detalhe P0001) |
| `js/auth.js` | Entrar, sair, exigir sessão, trocar senha, chamadas de contas |
| `js/layout.js` | Topo, menu, menu sanduíche e telas prontas |
| `js/pagina.js` | Iniciar página, períodos, avisos, janelas e confirmação |
| `js/util.js` | Datas, dias da semana, formatação, alertas |
| `js/cores.js` | 36 cores dos professores, tons do bloco, próxima cor livre |
| `js/semana.js` | Grade semanal (Agenda) |
| `js/analise.js` | Situação das turmas (Dashboard e Auditoria) |
| `js/dias-letivos.js` | Tabela de dias letivos e impressão |
| `js/calendario.js` | Enviar, abrir e remover o PDF do calendário |
| `js/planilha-gerar.js` | Gerador da planilha (puro; também roda no Node para testes) |
| Demais `js/<tela>.js` | Uma por tela (ver seção 7) |
| `css/base.css` | Identidade visual: paleta grafite + vermelho `#E0283F`, componentes e telas |
| `versao.sh` | Troca o `?v=` dos arquivos para o navegador baixar a versão nova |

---

## 9. Funções de servidor (Edge Functions)

**`gerenciar-usuarios`**: exige login. Usa a `service_role` só no servidor.

| Ação | Quem | O que faz |
|---|---|---|
| `trocar_senha` | o próprio usuário | Troca a senha seguindo as regras (recusa se a provisória já venceu) |
| `criar_acesso` | ADM | Cria o login `NIF@horario.local` com a senha provisória NIF + `cfp109`, válida por 7 dias |
| `resetar_senha` | ADM | Volta para a senha provisória e encerra as sessões |
| `bloquear_acesso` | ADM | Bloqueia o login |
| `reativar_acesso` | ADM | Desbloqueia o login |
| `excluir_professor` | ADM | Chama `excluir_professor` no banco e apaga o login |

---

## 10. Planilha da coordenação (Criar planilha)

- O **modelo confidencial** fica no banco (`modelo_planilha`, só ADM). Ele precisa ter as abas base `Nome docente`, `_base_grad` e `_base_pos`.
- **Uma aba por professor** com aula ou atividade no período:
  - graduação por matéria e subturma: "(CHT x - T1 e T2)" quando conjunta, "(CHP x - T1)" quando separada;
  - EAD síncrona e assíncrona (a assíncrona pela metade);
  - pós, com as datas e o número de semanas;
  - Extensão e atividades por tipo;
  - totais com as mesmas fórmulas e arredondamentos da planilha.
- **Colunas dos meses:** as do período. **Agosto e janeiro** saem divididos em duas metades (dias 1–15 e 16–fim).
- **Horário Graduação** por curso, com as turmas empilhadas, T1 e T2 lado a lado e uma cor por matéria. **Horário Pós** por turma.
- **Ficam em branco:**
  - as abas de RH;
  - titulação, admissão, cargo e Lattes;
  - a coluna "Módulo" da pós.
- **Avisos** quando o modelo não comporta tudo: 14 linhas de graduação, 9 de pós, 3 de "outras", 4 linhas de sábado e 2 subturmas.

---

## 11. Operação e manutenção

- **Publicar uma mudança no site:** rodar `./versao.sh` (troca o `?v=` de todos os arquivos), fazer commit e enviar para o ramo `main`. O GitHub Pages publica em 1 a 3 minutos.
- **Mudanças no banco:** feitas por *migrations* no Supabase. Lista no painel do projeto, de `01_tabelas` a `29_excluir_professor`.
- **Período novo:**
  1. criar em Configurações, já com as semanas letivas;
  2. cadastrar os dias não letivos, as reposições e as compensações;
  3. em Turmas, usar **Copiar de outro período**;
  4. ajustar os códigos das turmas, os professores das matérias e as aulas conjuntas;
  5. conferir a disponibilidade;
  6. Montar horário → **Preencher automaticamente** → ajustar → aceitar;
  7. marcar **Visível para professores** e enviar o calendário em PDF.
- **Antes de liberar para os professores:** Auditoria sem erros.
- **Backup do sistema anterior às grandes mudanças:** ramo `versao-1`.
