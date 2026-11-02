# claude-code-mods

Quatro mods para o [Claude Code](https://code.claude.com) que mudam a aparência e o comportamento dele no dia a dia. Funcionam no app desktop (aba Code), no terminal e na extensão do VS Code.

| Mod | O que faz | Comando |
| --- | --- | --- |
| **barra-creditos** | Faixa acima da caixa de texto com os limites de uso (5 h e semanal) em barras coloridas, o gasto da sessão e o do último prompt. | `/creditos` mostra ou esconde |
| **painel-controle** | Presets por atividade (Vídeo, Site/código, Automação, Pesquisa, Copy, Tráfego, Notas, Estratégia…): escolha a atividade e o modelo e o esforço trocam sozinhos, só naquela conversa. | `/modo` abre o painel · `/modo video` · `/modo off` |
| **time-agentes** | Cada subagente recebe o modelo da atividade que vai fazer (usa os presets do painel-controle) e aparece numa faixa com status, barra de consumo e %. Painel completo com o modelo por tipo de agente. | `/agentes` · `/agentes general-purpose opus` |
| **visao-limpa** | "O que eu fiz" em uma linha na faixa depois de cada resposta e, no VS Code e no terminal, cada ação vira uma linha curta em português com botão **detalhes**. | `/visao` · `/visao off` |

## Instalação

Precisa do Claude Code **2.1.309 ou mais novo** (os mods usam a API de mods, `claude plugin`). No terminal:

```bash
claude plugin marketplace add pedroguedespro/claude-code-mods
```

```bash
claude plugin install barra-creditos@claude-code-mods
```

```bash
claude plugin install painel-controle@claude-code-mods
```

```bash
claude plugin install time-agentes@claude-code-mods
```

```bash
claude plugin install visao-limpa@claude-code-mods
```

Ou, dentro de uma sessão do Claude Code no terminal, um por vez:

```
/plugin install barra-creditos --marketplace pedroguedespro/claude-code-mods
```

Responda `y` para adicionar o marketplace e escolha o escopo **user** para valer em todos os projetos. Sessões que já estavam abertas pegam os mods depois de reiniciar.

> O **time-agentes** depende do **painel-controle** (é de lá que vêm as atividades). Sem ele, o time-agentes ainda funciona e usa um modelo fixo por tipo de agente.

## Como cada um decide

**painel-controle**: o preset troca o modelo e o esforço em cada pedido da conversa principal, sem gravar nada nas suas configurações. O seletor de modelo da tela não acompanha; quem diz o modelo ativo é a linha de status (`Modo Vídeo: Opus · alto`). Para mudar um preset ou as palavras-chave, edite `mods/painel-controle/hooks/presets.ts` e rode `/reload-plugins`.

**time-agentes**: ordem de prioridade para o modelo de cada subagente:

1. modelo pedido explicitamente na chamada;
2. regra fixa que você definiu (`/agentes <tipo> <modelo>` ou os botões do painel);
3. atividade detectada pelas palavras-chave do título da tarefa (o detalhe só desempata; caminhos de arquivo são ignorados);
4. preset ativo da conversa (`/modo`);
5. padrão por tipo (`Explore → Haiku`, `general-purpose → Sonnet`, `Plan → Opus`).

O painel mostra o motivo e as palavras que decidiram, por exemplo `Opus · Vídeo (roteiro, video)`.

**visao-limpa**: o resumo só aparece em respostas que usaram 2 ou mais ferramentas e some no próximo pedido. "Rodou os testes" só conta quando o comando é um executor de testes de verdade (`npm test`, `vitest`, `pytest`, `claude plugin test`…). O app desktop já agrupa as ações sozinho, então lá só aparece o resumo.

## Limitações conhecidas

- O consumo por agente é em tokens e % do total, não em dólar (a API não informa o preço por agente). O gasto em US$ é o da sessão inteira, na barra de créditos.
- As barras de um agente crescem a cada pedido dele concluído, não a cada palavra.
- O esforço escolhido para um subagente pode não valer no primeiro pedido dele; o modelo vale desde o início.
- Palavras-chave nunca acertam 100%: quem escreve o título das tarefas é o Claude. O painel mostra as pistas para você ajustar a lista.

## Desenvolvimento

Cada mod é uma pasta em `mods/` com `.claude-plugin/plugin.json`, `hooks/` (o código, em TypeScript) e `tests/`.

```bash
claude plugin validate mods/time-agentes
```

```bash
claude plugin test mods/time-agentes
```

## Licença

MIT
