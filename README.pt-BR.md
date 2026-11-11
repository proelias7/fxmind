<p align="center">
  <img src="https://i.postimg.cc/zG0KyWXS/image.png" alt="fxmind" width="100%" />
</p>

<p align="center">
  <img src="https://i.postimg.cc/RZXKWfVh/fxmind.png" alt="fxmind" width="110" />
</p>

<h1 align="center">fxmind</h1>

<p align="center"><b>Uma memória compartilhada para todos os agentes de IA do seu projeto.</b><br/>
Cursor · Claude Code · Codex · Gemini CLI · OpenCode · Copilot</p>

<p align="center">
  <a href="https://proelias7.github.io/fxmind/">Site</a> ·
  <a href="README.md">English</a> ·
  <a href="docs/reference.md">Referência completa</a>
</p>

---

Seus agentes esquecem tudo entre um chat e outro, e cada um aprende o projeto do zero. O **fxmind** dá a eles uma memória única que mora no seu repositório, skills de especialista para a sua stack e um checklist de qualidade que eles precisam passar antes de dizer "pronto".

- **Memória compartilhada** — o que qualquer agente aprende fica em `.fxmind/memory/`, vai para o git junto com o código e é reaproveitado por todos os agentes e pelo time.
- **Packs de conhecimento** — boas práticas da sua stack: **Web** (React, Next.js, Vue, Node, APIs, bancos de dados, segurança, acessibilidade) e **FiveM** (vRP, QBCore, Qbox, ESX, NUI). O pack certo é escolhido automaticamente.
- **Trabalho verificado** — toda mudança passa por etapas curtas e por um revisor independente antes de ser aceita.
- **Decisões com a Jev AI (opcional)** — a Jev ajuda a escolher o tipo de tarefa, as memórias relevantes, as ferramentas e o que vale salvar. Desligada por padrão; nunca vê seu código nem os caminhos dos arquivos. Veja [docs/jev-optional.md](docs/jev-optional.md).
- **Feito para agentes em paralelo** — cada agente reserva os arquivos que vai editar, então dois agentes não sobrescrevem o trabalho um do outro.

## Instalar

Precisa do [Node.js](https://nodejs.org) 20.9+. Escolha uma forma:

**Peça ao seu agente** (qualquer agente) — cole isto no chat, dentro do projeto:

```text
Instale o fxmind neste projeto. Confira se o Node.js 20.9+ está instalado e rode na raiz do projeto:
npx --yes github:proelias7/fxmind --claude -y
(troque --claude pela flag do agente que você é: --codex, --cursor, --gemini, --opencode ou --copilot).
Ele instala o runtime do fxmind globalmente para o MCP e os hooks continuarem funcionando. Me mostre o resumo e peça para eu reiniciar você; depois eu rodo /fxmind init.
```

**Plugin** — Claude Code: `/plugin install fxmind --marketplace proelias7/fxmind` · Codex: `codex plugin marketplace add proelias7/fxmind` e depois `codex plugin add fxmind@fxmind`. Depois peça: *"configure o fxmind neste projeto"*.

**Terminal** — rode na pasta do projeto:

```bash
npx --yes github:proelias7/fxmind init
```

Escolha os packs, agentes e skills no terminal. A configuração pergunta se deseja ativar a Jev; a chave é solicitada com entrada oculta. Reinicie o agente e execute `/fxmind init` no chat para ler os módulos principais e criar as memórias.

Para configurar a Jev depois, separadamente:

```bash
npx --yes github:proelias7/fxmind jev
```

Se instalou o CLI globalmente, use `fxmind init` e `fxmind jev`. A chave fica em `~/.fxmind/jev.env`; não a envie pelo chat.

## Atualizar

```bash
npx --yes github:proelias7/fxmind --update -y
```

Suas memórias são mantidas; só os arquivos do próprio fxmind são atualizados.

## Usar

Converse com o agente normalmente. Alguns comandos ajudam:

| No chat do agente | O que faz |
|---|---|
| `/fxmind init` | Lê os módulos principais, aprende fatos verificados e monta o mapa do projeto |
| `/fxmind learn <tópico>` | Salva o que o agente verificou sobre uma parte do projeto |
| `/fxmind create <feature>` | Desenha uma feature nova, você aprova e ele constrói |
| `/fxmind audit <pasta>` | Relatório de segurança e performance |

No Codex use `$fxmind`; no Gemini, `/fxmind:learn`.

## Opções

```bash
npx --yes github:proelias7/fxmind --claude -y        # escolha o agente: --cursor --claude --codex --gemini --opencode --copilot
npx --yes github:proelias7/fxmind --pack web -y      # escolha o pack: web, fivem (padrão: detectado)
```

O resto — ferramentas MCP, hooks, painel web, instalação global, packs próprios — está na [referência completa](docs/reference.md).

## Licença

MIT — [proelias7](https://github.com/proelias7)
