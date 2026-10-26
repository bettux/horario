# Horário — Sistema de alocação de aula (Graduação e Pós, Vila Mariana)

Site estático (GitHub Pages) + Supabase (banco, login e regras).

## Estrutura
```
index.html              login por NIF
primeiro-acesso.html    troca obrigatória da senha provisória
minhas-aulas.html       aulas do professor logado
inicio.html             painel do administrador
css/base.css            cores, componentes e layout
js/config.js            URL e chave PÚBLICA do Supabase
js/supabase.js          cliente e chamadas às funções do banco
js/auth.js              login, sessão, troca de senha
js/layout.js            topo e menu lateral
```

## Segurança
- No site vai só a chave **pública**. A chave secreta fica apenas na função `gerenciar-usuarios` do Supabase.
- Todas as tabelas têm RLS: só o administrador acessa diretamente; o professor vê apenas as próprias aulas por `minhas_aulas`.
- Senha provisória: NIF + `cfp109`, válida por 7 dias, troca obrigatória no primeiro acesso.

## Publicar
GitHub → Settings → Pages → Source: *Deploy from a branch* → branch `main`, pasta `/ (root)`.

## Testar localmente
Qualquer servidor estático (ex.: Live Server do VS Code) abrindo `index.html`.
