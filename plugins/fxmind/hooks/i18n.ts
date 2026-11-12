// The effort bar's words in the person's language. The code keeps its English strings; what a person reads is turned
// here as it is drawn (theme.ts wraps the elements), said in a toast or answered by a command. English is the identity.

export type Language = 'en' | 'pt-BR'
export const LANGUAGES: readonly Language[] = ['en', 'pt-BR']

let language: Language = 'en'
export const setLanguage = (to: Language) => {
  language = to
}
export const getLanguage = () => language

const PT: Record<string, string> = {
  // Effort levels and the lean.
  Low: 'Baixo', Medium: 'Médio', High: 'Alto', XHigh: 'Extra', Max: 'Máximo', Min: 'Mín',
  low: 'baixo', medium: 'médio', high: 'alto', xhigh: 'extra', max: 'máximo',
  Cheapest: 'Mais barato', Cheaper: 'Barato', Balanced: 'Equilibrado', Smarter: 'Inteligente', Smartest: 'Mais inteligente',
  helpers: 'auxiliares', working: 'funcionando', failing: 'falhando',

  // The dashboard and the footer.
  Deciding: 'Decidindo', 'Deciding…': 'Decidindo…', Off: 'Desligado', Paused: 'Pausado', 'Auto paused': 'Auto pausado',
  Cache: 'Cache', Compact: 'Compactar', Settings: 'Configurações', Setup: 'Configurar', 'cache cold': 'cache frio',
  'Auto on': 'Auto ligado', 'Auto off': 'Auto desligado', 'Handoff box': 'Caixa de handoff',
  'Auto picks the effort at the next prompt': 'O Auto escolhe o esforço no próximo prompt',
  'You pick the effort': 'Você escolhe o esforço',
  'Picks the effort at the next prompt': 'Escolhe o esforço no próximo prompt',
  'Pick an effort': 'Escolha um esforço',
  'Switch to': 'Trocar para', '? The context reloads.': '? O contexto é recarregado.', Switch: 'Trocar', Keep: 'Manter',
  'Auto is off: the effort stays as you set it. The power button turns Auto on.': 'Auto desligado: o esforço fica como você definiu. O botão liga o Auto.',
  'Auto waits on this model: an effort change would rewrite its prompt cache.': 'O Auto espera neste modelo: mudar o esforço reescreveria o cache de prompt.',
  'This model runs without an effort level, so Auto has nothing to set.': 'Este modelo roda sem nível de esforço, então o Auto não tem o que ajustar.',
  'Auto picks the effort for each message': 'O Auto escolhe o esforço de cada mensagem',
  'your pick': 'sua escolha', 'your pick in the app': 'sua escolha no app', 'you asked for it': 'você pediu',
  'unsure, keeping': 'incerto, mantendo',

  // Settings: cards.
  Effort: 'Esforço', Model: 'Modelo', 'Handoff & alerts': 'Handoff e alertas', Customize: 'Personalizar', Judge: 'Juiz',
  'Cheaper when it can': 'Mais barato quando der', "Always the chat's": 'Sempre o do chat',
  'Built in': 'Embutido', Minimal: 'Mínimo', Dashboard: 'Painel',

  // Settings: header and rows.
  '← Back': '← Voltar', Back: 'Voltar', Next: 'Avançar', Done: 'Concluir', Skip: 'Pular', Save: 'Salvar', Go: 'Ir',
  'Settings saved': 'Configurações salvas',
  'Checking…': 'Verificando…', 'Up to date': 'Atualizado', 'Check for updates': 'Buscar atualizações',
  'Report a bug': 'Reportar um bug', Uninstall: 'Desinstalar', 'Uninstalling…': 'Desinstalando…',
  'Press again to uninstall': 'Pressione de novo para desinstalar',
  Helpers: 'Auxiliares', 'Helpers on': 'Auxiliares ligados', 'Helpers off': 'Auxiliares desligados',
  'Haiku (Jev if added)': 'Haiku (Jev se adicionada)', 'Haiku only': 'Só Haiku',
  'Key saved. Paste to replace': 'Chave salva. Cole para trocar', 'Paste TypeSafe key': 'Cole a chave TypeSafe',
  'Testing…': 'Testando…', Test: 'Testar', 'No TypeSafe key found': 'Nenhuma chave TypeSafe encontrada',
  'Jev gave no usable answer': 'A Jev não deu uma resposta utilizável', 'Haiku gave no answer': 'O Haiku não respondeu',
  'Jev could not be reached': 'Não foi possível falar com a Jev',
  'Compact with': 'Compactar com', "Chat's model": 'Modelo do chat',
  'Handoff skill': 'Skill de handoff', 'fxmind (built in)': 'fxmind (embutido)',
  'Compact alert at': 'Alerta de compactação em', 'Handoff button': 'Botão de handoff',
  'When advised': 'Quando recomendado', Always: 'Sempre',
  Look: 'Visual', Appearance: 'Aparência', 'Match Claude Code': 'Igual ao Claude Code', Dark: 'Escuro', Light: 'Claro',
  Theme: 'Tema', Violet: 'Violeta', 'Claude orange': 'Laranja Claude', 'Cherry blossom': 'Flor de cerejeira',
  Language: 'Idioma',
  'Prompt refiner': 'Refinador de prompt', Automatic: 'Automático', 'Command only': 'Só por comando',
  'Refine with': 'Refinar com', 'Clear chat': 'Limpar o chat', Yes: 'Sim', No: 'Não',
  'Gate V review': 'Revisão do Gate V', 'Ask me': 'Perguntar', Review: 'Revisar',
  'Review before closing?': 'Revisar antes de fechar?', Reviewer: 'Revisor',
  'Refined prompt': 'Prompt refinado', Send: 'Enviar', 'Review first': 'Revisar antes',
  'Map project': 'Mapear projeto', 'Review memories': 'Rever memórias', Learn: 'Aprender',
  'reading the demand…': 'lendo a demanda…', 'writing the prompt…': 'montando o prompt…', 'ready to write': 'pronto para montar',
  'pick or answer in the chat': 'escolha ou responda no chat', 'Send as typed': 'Enviar sem refinar', 'Write now': 'Montar agora',
  'Write prompt': 'Montar prompt', 'the model did not answer': 'o modelo não respondeu',
  'fxmind: answer saved, writing the prompt…': 'fxmind: resposta registrada, montando o prompt…',
  'fxmind: choose above the prompt: Write prompt, Send as typed or ✕': 'fxmind: escolha acima do prompt: Montar prompt, Enviar sem refinar ou ✕',
  'fxmind: wait, the refiner is still on the previous demand (above the prompt)': 'fxmind: aguarde, o refinador está trabalhando na demanda anterior (acima do prompt)',
  'fxmind: the demand is clear, writing the refined prompt…': 'fxmind: demanda clara, montando o prompt refinado…',
  'fxmind: the refined prompt is in the prompt box. Review it and send.': 'fxmind: prompt refinado no campo de texto. Revise e envie.',
  'The refiner is already working on a demand (above the prompt).': 'O refinador já está trabalhando em uma demanda (acima do prompt).',
  'Refining the demand above the prompt.': 'Refinando a demanda acima do prompt.',
  'Cache timer': 'Timer do cache', 'Judge line': 'Linha do juiz', 'Context alert': 'Alerta de contexto',
  'Running low alert': 'Alerta de limite', 'Cold cache alert': 'Alerta de cache frio',

  // Compact and handoff bars.
  'Handoff instead': 'Fazer handoff', 'Compact instead': 'Compactar', 'Summary (optional)': 'Resumo (opcional)',
  Quick: 'Rápido', Full: 'Completo', 'Quick handoff': 'Handoff rápido', 'Full handoff': 'Handoff completo',
  'Clear & carry on': 'Limpar e continuar', 'Clear & wait': 'Limpar e aguardar', 'Keep chat & copy': 'Manter chat e copiar',
  'Saves HANDOFF.md': 'Salva HANDOFF.md', 'A few seconds': 'Alguns segundos', 'A few seconds.': 'Alguns segundos.',
  'Checks git and saves HANDOFF.md, slower': 'Confere o git e salva HANDOFF.md, mais lento', 'Done in seconds': 'Pronto em segundos',
  'Copied, chat stays.': 'Copiado, o chat fica.', 'Clears chat, then waits.': 'Limpa o chat e aguarda.',
  'Clears chat, carries on.': 'Limpa o chat e continua.',
  'Handing off…': 'Fazendo handoff…', 'Your skill takes a little while.': 'Sua skill leva um tempinho.',
  'Full handoff being written.': 'Handoff completo sendo escrito.', 'Quick handoff being written.': 'Handoff rápido sendo escrito.',
  'Handoff complete': 'Handoff concluído', 'Carried on from the last chat. The old one is cleared.': 'Continuando do chat anterior. O antigo foi limpo.',
  'Handoff copied': 'Handoff copiado', 'Paste it into a new chat. This one stays.': 'Cole em um chat novo. Este continua aqui.',
  'Compacting…': 'Compactando…', 'The chat is being summed up. Takes a minute or so.': 'O chat está sendo resumido. Leva cerca de um minuto.',
  'Compact complete': 'Compactação concluída', 'The chat is summed up; the next message reads far less.': 'O chat foi resumido; a próxima mensagem lê bem menos.',

  // Alerts.
  'Judge down': 'Juiz fora do ar', 'Open settings': 'Abrir configurações',
  'Running hot': 'Limite chegando', 'Save mode': 'Modo economia', 'Save mode on': 'Modo economia ligado',
  'Chat went cold': 'O chat esfriou', 'Not now': 'Agora não',
  'Chat is getting swamped': 'O chat está ficando pesado',
  'Jev is out of credits (402)': 'A Jev está sem créditos (402)',

  // Setup guide.
  'Haiku judges. Add Jev too?': 'O Haiku julga. Adicionar a Jev também?',
  'Just Haiku (no key)': 'Só Haiku (sem chave)', 'Add Jev (needs a key)': 'Adicionar Jev (precisa de chave)',
  'TypeSafe key': 'Chave TypeSafe', 'Key from typesafe.ai:': 'Chave do typesafe.ai:', 'Dark or light panels?': 'Painéis escuros ou claros?',

  // Update card.
  Update: 'Atualizar', Later: 'Depois', 'Copy install command': 'Copiar comando de instalação', 'Try again': 'Tentar de novo',
  "What's new →": 'Novidades →', Share: 'Compartilhar', 'Star on GitHub': 'Estrela no GitHub',
  'A new version is ready.': 'Uma nova versão está pronta.', 'Updating…': 'Atualizando…', 'Update failed': 'Falha na atualização',
  'Loaded in this chat.': 'Carregada neste chat.', 'Installed. Open a new chat to load it.': 'Instalada. Abra um chat novo para carregar.',
  'Press Enter to load it': 'Pressione Enter para carregar', 'Installed. Loads as soon as Claude is idle.': 'Instalada. Carrega assim que o Claude ficar livre.',
  'Link copied. Send it to a friend.': 'Link copiado. Mande para um amigo.',
  'Install command copied. Paste it in PowerShell or Terminal, then reopen the app.': 'Comando de instalação copiado. Cole no PowerShell ou Terminal e reabra o app.',

  // Agent panel and progress bar.
  Agents: 'Agentes', 'This chat': 'Este chat', Map: 'Mapa', changed: 'alterado', read: 'lido',
  'picking a model': 'escolhendo um modelo', 'a tool': 'uma ferramenta', starting: 'iniciando', waiting: 'aguardando',
  'reported back': 'retornaram', 'Agents show here when Claude sends some off.': 'Os agentes aparecem aqui quando o Claude dispara algum.',
  'All done': 'Tudo pronto', Quiet: 'Parado', planning: 'planejando', 'Planning a bigger task': 'Planejando uma tarefa maior',

  // Toasts.
  'Could not switch the model right now': 'Não foi possível trocar o modelo agora',
  'fxmind: handoff copied. Paste it into a new chat.': 'fxmind: handoff copiado. Cole em um chat novo.',
  'fxmind: the clipboard refused, so the handoff is in the prompt box': 'fxmind: a área de transferência recusou, então o handoff está no campo do prompt',
  'fxmind: no home folder found to save the key in.': 'fxmind: pasta do usuário não encontrada para salvar a chave.',
  'fxmind: key saved. Jev judges from the next message.': 'fxmind: chave salva. A Jev julga a partir da próxima mensagem.',
  'fxmind: Haiku 5.5 judges, no key needed. Add a Jev key later for faster answers.': 'fxmind: o Haiku 5.5 julga, sem chave. Adicione uma chave Jev depois para respostas mais rápidas.',
  'fxmind: Jev judges with the TypeSafe key it found.': 'fxmind: a Jev julga com a chave TypeSafe encontrada.',
  'fxmind is uninstalled. Thanks for trying it.': 'fxmind desinstalado. Obrigado por experimentar.',
  'fxmind: could not copy the link': 'fxmind: não foi possível copiar o link',
  'fxmind: the handoff was not written, nothing was cleared': 'fxmind: o handoff não foi escrito, nada foi limpo',

  // Command replies.
  'Auto on: effort is picked for every prompt.': 'Auto ligado: o esforço é escolhido a cada prompt.',
  'Auto off: the effort is yours.': 'Auto desligado: o esforço é seu.',
  'The fxmind settings are open above the prompt.': 'As configurações do fxmind estão abertas acima do prompt.',
  'The fxmind setup is open above the prompt.': 'A configuração inicial do fxmind está aberta acima do prompt.',
  'The agent panel is open.': 'O painel de agentes está aberto.',
  'The agent panel shows sample agents (a preview).': 'O painel de agentes mostra agentes de exemplo (uma prévia).',
  'No model suggestion right now.': 'Nenhuma sugestão de modelo agora.', 'Keeping the current model.': 'Mantendo o modelo atual.',
  'The progress bar is cleared.': 'A barra de progresso foi limpa.',
}

const LEVEL = '(low|medium|high|xhigh|max)'
const level = (word: string) => PT[word] ?? word

// Strings with a value in them: the pattern, and the Portuguese with the value put back.
const RULES: readonly [RegExp, (m: RegExpMatchArray) => string][] = [
  [new RegExp(`^${LEVEL} to ${LEVEL}$`), m => `${level(m[1]!)} a ${level(m[2]!)}`],
  [new RegExp(`^range ${LEVEL} to ${LEVEL}$`), m => `faixa ${level(m[1]!)} a ${level(m[2]!)}`],
  [/^Lean: (.+)$/, m => `Tendência: ${({ 'much cheaper': 'bem mais barato', cheaper: 'mais barato', 'as the judge says': 'como o juiz diz', smarter: 'mais inteligente', 'much smarter': 'bem mais inteligente' } as Record<string, string>)[m[1]!] ?? m[1]}`],
  [/^Why: (.+)$/, m => `Motivo: ${tr(m[1]!)}`],
  [/^(\d+)% sure$/, m => `${m[1]}% de certeza`],
  [/^compact alert at (\d+)%$/, m => `alerta de compactação em ${m[1]}%`],
  [/^(\d+) of (\d+) on$/, m => `${m[1]} de ${m[2]} ativos`],
  [/^Context (\d+)%$/, m => `Contexto ${m[1]}%`],
  [/^cache (.+)$/, m => `cache ${m[1]}`],
  [/^Handoff would suit: (.+)$/, m => `Handoff recomendado: ${m[1]}`],
  [/^Update to (.+)$/, m => `Atualizar para ${m[1]}`],
  [/^Updating to (.+)…$/, m => `Atualizando para ${m[1]}…`],
  [/^Updated to (.+)$/, m => `Atualizado para ${m[1]}`],
  [/^fxmind (\S+) is out$/, m => `fxmind ${m[1]} disponível`],
  [/^Getting (\S+)\.$/, m => `Baixando ${m[1]}.`],
  [/^Takes a few seconds\.$/, () => 'Leva alguns segundos.'],
  [/^fxmind setup(.*)$/, m => `Configuração do fxmind${m[1]}`],
  [/^(.+)\. Haiku stands in\.$/, m => `${tr(m[1]!)}. O Haiku assume.`],
  [/^(\d+)% of your (.+) limit used$/, m => `${m[1]}% do seu limite ${m[2]} usado`],
  [/^resets (.+)$/, m => `renova ${m[1]}`],
  [/^Hand off or compact first\.$/, () => 'Faça handoff ou compacte antes.'],
  [/^Rereads (.+) tokens at full price\.$/, m => `Relê ${m[1]} tokens a preço cheio.`],
  [/^Next message rereads (.+) tokens at full price\.$/, m => `A próxima mensagem relê ${m[1]} tokens a preço cheio.`],
  [/^(\d+)k tokens \((\d+)% of context\) re-read every message\.$/, m => `${m[1]}k tokens (${m[2]}% do contexto) relidos a cada mensagem.`],
  [/^(\d+)k tokens re-read every message\.$/, m => `${m[1]}k tokens relidos a cada mensagem.`],
  [/^Prompt cache cold: the next message reads the whole chat again at full price\.$/, () => 'Cache de prompt frio: a próxima mensagem relê o chat inteiro a preço cheio.'],
  [/^Compact first to save\.$/, () => 'Compacte antes para economizar.'],
  [/^Prompt cache warm for (.+) more: the next message reads the chat from cache, cheap and fast\.$/, m => `Cache de prompt quente por mais ${m[1]}: a próxima mensagem lê o chat do cache, barato e rápido.`],
  [/^question (\d+) of (\d+)$/, m => `dúvida ${m[1]} de ${m[2]}`],
  [/^Could not write the prompt: (.*)$/, m => `Não consegui montar o prompt: ${tr(m[1]!)}`],
  [/^fxmind: answer (\d+) of (\d+) saved$/, m => `fxmind: resposta ${m[1]} de ${m[2]} registrada`],
  [/^fxmind: (\d+) questions? before building\. Answer above the prompt\.$/, m => `fxmind: ${m[1]} ${m[1] === '1' ? 'dúvida' : 'dúvidas'} antes de implementar. Responda acima do prompt.`],
  [/^Prompt refiner: (automatic|command only|off)(.*?)\. Use \/fxmind-refine <demand>, or auto, command, off\.$/, m => `Refinador de prompt: ${({ automatic: 'automático', 'command only': 'só por comando', off: 'desligado' } as Record<string, string>)[m[1]!]}${m[2]}. Use /fxmind-refine <demanda>, ou auto, command, off.`],
  [/^Prompt refiner: (.+)$/, m => `Refinador de prompt: ${({ 'automatic: implementation demands are refined before they reach the agent.': 'automático: demandas de implementação são refinadas antes de chegar ao agente.', 'command only: /fxmind-refine <demand>.': 'só por comando: /fxmind-refine <demanda>.', 'off.': 'desligado.' } as Record<string, string>)[m[1]!] ?? m[1]}`],
  [/^(\d+) memories$/, m => `${m[1]} memórias`],
  [/^(\d+) to review$/, m => `${m[1]} a rever`],
  [/^task ([ABVC][✓·] [ABVC][✓·] [ABVC][✓·] [ABVC][✓·])$/, m => `tarefa ${m[1]}`],
  [/^Step (\d+) of (\d+)$/, m => `Passo ${m[1]} de ${m[2]}`],
  [/^Paused at step (\d+) of (\d+)$/, m => `Pausado no passo ${m[1]} de ${m[2]}`],
  [/^Waiting for your answer$/, () => 'Aguardando sua resposta'],
  [/^step (\d+) of (\d+)$/, m => `passo ${m[1]} de ${m[2]}`],
  [/^all (\d+) steps$/, m => `todos os ${m[1]} passos`],
  [/^(\d+) agents?$/, m => `${m[1]} agente${m[1] === '1' ? '' : 's'}`],
  [/^(\d+) parts? touched$/, m => `${m[1]} parte${m[1] === '1' ? ' tocada' : 's tocadas'}`],
  [/^waiting on (.+)$/, m => `aguardando ${tr(m[1]!)}`],
  [/^failed after (.+)$/, m => `falhou após ${m[1]}`],
  [/^(\d+) done$/, m => `${m[1]} concluído${m[1] === '1' ? '' : 's'}`],
  [/^(.+) \(helpers start at medium\)$/, m => `${m[1]} (auxiliares começam no médio)`],
  [/^Switching to (.+)\.$/, m => `Trocando para ${m[1]}.`],
  [/^The context reloads\.$/, () => 'O contexto é recarregado.'],
  [/^Writing the (full|quick) handoff\.$/, m => `Escrevendo o handoff ${m[1] === 'full' ? 'completo' : 'rápido'}.`],
  [/^Suggestion: switch to (.+)\? \/fxmind-effort switch or \/fxmind-effort keep$/, m => `Sugestão: trocar para ${m[1]}? /fxmind-effort switch ou /fxmind-effort keep`],
  [/^Press Enter to send (.+) so the app's own control follows$/, m => `Pressione Enter para enviar ${m[1]} e o controle do app acompanhar`],
  [/^Bug report link copied: (.+)$/, m => `Link para reportar bug copiado: ${m[1]}`],
  [/^fxmind: (.+)\. Haiku judges for now\.$/, m => `fxmind: ${tr(m[1]!)}. O Haiku julga por enquanto.`],
  [/^fxmind: compact failed: (.*)$/, m => `fxmind: falha ao compactar: ${m[1]}`],
  [/^fxmind: handoff failed: (.*)$/, m => `fxmind: falha no handoff: ${m[1]}`],
  [/^fxmind: the fork wrote no handoff \((.*)\); writing it as a turn$/, m => `fxmind: o fork não escreveu o handoff (${m[1]}); escrevendo como um turno`],
  [/^fxmind: could not save (\S+): (.*)$/, m => `fxmind: não foi possível salvar ${m[1]}: ${m[2]}`],
  [/^fxmind: could not save the key: (.*)$/, m => `fxmind: não foi possível salvar a chave: ${m[1]}`],
  [/^fxmind: uninstall failed: (.*)$/, m => `fxmind: falha ao desinstalar: ${m[1]}`],
  [/^fxmind: Haiku could not compact \((.*)\)\. The chat's own model does it\.$/, m => `fxmind: o Haiku não conseguiu compactar (${m[1]}). O modelo do chat faz isso.`],
  [/^fxmind: Auto is off\. You picked (.+); turn Auto on to hand it back\.$/, m => `fxmind: Auto desligado. Você escolheu ${tr(m[1]!)}; ligue o Auto para devolver o controle.`],
  [/^fxmind: run (.+)$/, m => `fxmind: rode ${m[1]}`],
  [/^Review with (.+)$/, m => `Revisar com ${m[1]}`],
  [/^Review 1 file before closing\?$/, () => 'Revisar 1 arquivo antes de fechar?'],
  [/^Review (\d+) files before closing\?$/, m => `Revisar ${m[1]} arquivos antes de fechar?`],
  [/^fxmind: report a bug at (.+)$/, m => `fxmind: reporte um bug em ${m[1]}`],
  [/^This needs the Claude Code CLI\. Install it with (.+), then reopen the app\.$/, m => `Isto precisa da CLI do Claude Code. Instale com ${m[1]} e reabra o app.`],
]

// Marks drawn before or after the words: a star, a tick box, an arrow, an ellipsis. They stay where they are.
const LEAD = /^([\s✦⇥←→✓✗⚠◉○☐☑└·︎]+)/u
const TAIL = /([\s›→:]+)$/u

function whole(text: string): string | undefined {
  const exact = PT[text]
  if (exact !== undefined) return exact
  for (const [pattern, say] of RULES) {
    const m = text.match(pattern)
    if (m) return say(m)
  }
  return undefined
}

function core(text: string): string | undefined {
  const direct = whole(text)
  if (direct !== undefined) return direct
  const lead = text.match(LEAD)?.[1] ?? ''
  const rest = text.slice(lead.length)
  const tail = rest.match(TAIL)?.[1] ?? ''
  const inner = tail ? rest.slice(0, -tail.length) : rest
  if ((lead || tail) && inner) {
    const turned = whole(inner)
    if (turned !== undefined) return lead + turned + tail
  }
  return undefined
}

/** One piece of text in the chosen language. What has no translation stays as it is: a file name, the judge's own words. */
export function tr(text: string): string {
  if (language === 'en' || !text) return text
  const direct = core(text)
  if (direct !== undefined) return direct
  // Parts joined by a middle dot, then sentences, each turned on its own: "High · Auto paused", "A. B."
  for (const split of [/( · )/, /(?<=[.!?…])( )/]) {
    const parts = text.split(split)
    if (parts.length > 1) {
      const turned = parts.map(part => (split.test(part) && part.trim().length <= 1 ? part : (core(part) ?? part)))
      const joined = turned.join('')
      if (joined !== text) return joined
    }
  }
  return text
}

const TEXT_PROPS = ['label', 'placeholder', 'submitLabel', 'title']
function turn(value: unknown): unknown {
  if (typeof value === 'string') return tr(value)
  if (!Array.isArray(value)) return value
  let changed = false
  const out = value.map(item => {
    const turned = turn(item)
    if (turned !== item) changed = true
    return turned
  })
  return changed ? out : value
}

/** An element's props with the words a person reads in the chosen language: its text, label, placeholder and choices. */
export function trProps(props: Record<string, unknown>): Record<string, unknown> {
  if (language === 'en') return props
  let out = props
  const put = (key: string, value: unknown) => {
    if (value !== props[key]) out = { ...out, [key]: value }
  }
  for (const key of TEXT_PROPS) if (typeof props[key] === 'string') put(key, tr(props[key] as string))
  put('children', turn(props.children))
  if (Array.isArray(props.options)) {
    const options = (props.options as unknown[]).map(o => (o && typeof o === 'object' && typeof (o as { label?: unknown }).label === 'string' ? { ...(o as object), label: tr((o as { label: string }).label) } : o))
    out = { ...out, options }
  }
  return out
}

/** An SVG's own words (its <text> nodes) in the chosen language; the drawing stays. */
export function trSvg(source: string): string {
  if (language === 'en' || !source.includes('<text')) return source
  return source.replace(/(<(?:text|tspan)\b[^>]*>)([^<]+)(?=<)/g, (_all, open: string, words: string) => open + tr(words))
}
