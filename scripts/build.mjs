import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { watch } from 'node:fs'

const isWatch = process.argv.includes('--watch')

async function buildAll() {
  await mkdir('dist', { recursive: true })

  await build({
    entryPoints: ['src/plugin/controller.ts'],
    outfile: 'dist/code.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2021',
    sourcemap: isWatch ? 'inline' : false,
    minify: !isWatch,
    logLevel: 'warning',
  })

  const uiBuild = await build({
    entryPoints: ['src/ui/index.tsx'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2021',
    sourcemap: isWatch ? 'inline' : false,
    minify: !isWatch,
    write: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify(isWatch ? 'development' : 'production'),
    },
    logLevel: 'warning',
  })

  const js = uiBuild.outputFiles.find((file) => file.path.endsWith('.js'))?.text
    ?? uiBuild.outputFiles[0]?.text
  if (!js) throw new Error('UI bundle was not generated')
  const css = await readFile('src/ui/styles.css', 'utf8')
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${js.replaceAll('</script>', '<\\/script>')}</script>
  </body>
</html>`
  await writeFile('dist/ui.html', html)
  process.stdout.write(`Sketch Arrow built at ${new Date().toLocaleTimeString()}\n`)
}

let buildTimer
async function scheduleBuild() {
  clearTimeout(buildTimer)
  buildTimer = setTimeout(() => {
    buildAll().catch((error) => console.error(error))
  }, 80)
}

await buildAll()

if (isWatch) {
  watch('src', { recursive: true }, scheduleBuild)
  process.stdout.write('Watching src/ for changes…\n')
}
