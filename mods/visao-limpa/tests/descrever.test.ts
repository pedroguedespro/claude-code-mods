import { expect, test } from 'claude-code/testing'

import { linha, resumir } from '../hooks/descrever'

test('cada ação vira uma linha curta em português', () => {
  expect(linha('Read', { file_path: String.raw`C:\proj\src\app\page.tsx` })).toBe('Leu page.tsx')
  expect(linha('Grep', { pattern: 'useState', path: 'src' })).toBe('Buscou "useState" em src')
  expect(linha('Edit', { file_path: '/p/components/Hero.tsx', old_string: 'a\nb', new_string: 'a\nb\nc' })).toBe('Editou Hero.tsx (+3 −2)')
  expect(linha('Bash', { command: 'npm test', description: 'Roda os testes' })).toBe('Rodou: Roda os testes')
  expect(linha('Bash', { command: 'npm test' }, true)).toBe('Rodando: npm test')
  expect(linha('WebFetch', { url: 'https://example.com/docs' })).toBe('Abriu example.com/docs')
  expect(linha('mcp__88500095-c235-4d04-b66b-9f95fe4fe584__notion-search', {})).toBe('Usou notion-search')
  expect(linha('mcp__github__create_issue', {})).toBe('Usou github create_issue')
})

test('o resumo do turno agrupa por tipo de trabalho', () => {
  const r = resumir([
    { tool: 'Read', input: { file_path: '/p/page.tsx' }, erro: false },
    { tool: 'Read', input: { file_path: '/p/Hero.tsx' }, erro: false },
    { tool: 'Grep', input: { pattern: 'x' }, erro: false },
    { tool: 'Edit', input: { file_path: '/p/Hero.tsx', old_string: 'a', new_string: 'a\nb' }, erro: false },
    { tool: 'Edit', input: { file_path: '/p/Hero.tsx', old_string: 'c', new_string: 'd' }, erro: false },
    { tool: 'Write', input: { file_path: '/p/novo.ts', content: '1\n2\n3' }, erro: false },
    { tool: 'Bash', input: { command: 'npx vitest run' }, erro: false },
    { tool: 'Bash', input: { command: 'git status' }, erro: false },
    { tool: 'Bash', input: { command: 'ls /nao-existe' }, erro: true },
    { tool: 'Agent', input: { description: 'Pesquisar concorrentes' }, erro: false },
    { tool: 'TodoWrite', input: {}, erro: false },
    { tool: 'mcp__ccd_turn__update_plan', input: {}, erro: false },
  ])
  expect(r).toEqual([
    'Leu 2 arquivos (page.tsx, Hero.tsx)',
    'Buscou 1 vez no projeto',
    'Editou Hero.tsx (+3 −2), criou novo.ts',
    'Rodou os testes ✓',
    'Rodou 2 comandos · 1 falhou',
    'Delegou 1 agente (Pesquisar concorrentes)',
  ])
})

test('testes que falham aparecem com ✗', () => {
  expect(resumir([{ tool: 'Bash', input: { command: 'claude plugin test mods/x' }, erro: true }])).toEqual(['Rodou os testes ✗ (1 falha)'])
})

test('só ruído de interface não vira resumo', () => {
  expect(resumir([{ tool: 'TodoWrite', input: {}, erro: false }])).toEqual([])
})

test('revisão Codex: só executor de testes conta, falhas de arquivo à parte, mesmos nomes em pastas diferentes', () => {
  const cmd = (command: string, erro = false) => ({ tool: 'Bash', input: { command }, erro })
  expect(resumir([cmd('ls tests'), cmd('echo test'), cmd('cat test.json'), cmd('echo npm test'), cmd('echo pytest'), cmd('cat vitest.config.ts')])).toEqual(['Rodou 6 comandos'])
  expect(resumir([cmd('CI=1 npm test'), cmd('npm run lint && npm test'), cmd('FOO="a b" BAR=\'c\' npm test')])).toEqual(['Rodou os testes ✓'])
  // separadores dentro de aspas não abrem um trecho novo, e uma variável com aspas não esconde o comando real
  expect(
    resumir([
      cmd('echo "x; npm test"'),
      cmd("printf '%s' 'x|pytest'"),
      cmd('echo x \\; pytest'),
      cmd('NOTE="run npm test" echo ok'),
      cmd('X="npm test"'),
    ]),
  ).toEqual(['Rodou 5 comandos'])
  expect(resumir([cmd('echo "ok" && pytest -q')])).toEqual(['Rodou os testes ✓'])
  expect(resumir([cmd('npm test'), cmd('npx vitest run'), cmd('cd x && pytest -q'), cmd('claude plugin test mods/a')])).toEqual(['Rodou os testes ✓'])
  expect(
    resumir([
      { tool: 'Read', input: { file_path: '/a/x.ts' }, erro: true },
      { tool: 'Edit', input: { file_path: '/a/index.ts', old_string: 'a', new_string: 'b' }, erro: false },
      { tool: 'Edit', input: { file_path: '/b/index.ts', old_string: 'a', new_string: 'b\nc' }, erro: false },
      { tool: 'Edit', input: { file_path: '/c/y.ts', old_string: 'a', new_string: 'b' }, erro: true },
    ]),
  ).toEqual(['Editou index.ts (+1 −1), index.ts (+2 −1)', '2 leituras/edições falharam'])
})
