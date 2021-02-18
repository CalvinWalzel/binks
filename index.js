#!/usr/bin/env node

const VERSION = require('./package.json').version

const exec = require('child_process').exec
const spawn = require('child_process').spawn
const fsmonitor = require('fsmonitor')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const MONITORS = [
  {
    path: './features/',
    regex: /\.feature$/i
  },
  {
    path: './spec/',
    regex: /_spec\.rb$/i
  }
]

let globalLock = false

let focusCache = null

let childProcess

let branch

let branchCleaning = false

try {
  branch = fs.readFileSync(toTotalPath('/HEAD', './.git'), 'utf8').replace('ref: refs/heads/', '').replace('\n', '')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

// TODO: Add process.argv parsing to add headless mode
// TODO: Keep pid & ppid & clean up Chrome & other dead processes

async function setup () {
  MONITORS.forEach(async config => {
    const monitor = fsmonitor.watch(config.path, {
      // include files
      matches: function (relpath) {
        return relpath.match(config.regex) !== null
      },
      // exclude directories
      excludes: function (relpath) {
        return false
      }
    })

    monitor.on('change', async function (changes) {
      if (globalLock) return

      globalLock = true

      const files = changes.addedFiles.concat(changes.modifiedFiles)

      const commands = buildCommands(files, config.path)
      const command = commands[0]

      if (command) {
        childProcess = executeCommand(command)

        await onExit(childProcess)

        childProcess = undefined
      }

      globalLock = false
    })
  })

  const branchMonitor = fsmonitor.watch('.git/', {
    // include files
    matches: function (relpath) {
      return relpath.match(/HEAD$/) !== null
    },
    // exclude directories
    excludes: function (relpath) {
      return false
    }
  })

  branchMonitor.on('change', async function (changes) {
    const newBranch = fs.readFileSync(toTotalPath('/HEAD', './.git'), 'utf8').replace('ref: refs/heads/', '').replace('\n', '')

    if (branch === newBranch) {
      return
    }

    branchCleaning = true
    globalLock = true

    // exit any running process
    if (childProcess) {
      childProcess.kill('SIGINT')
      setTimeout(function () {
        if (childProcess) {
          childProcess.kill('SIGINT')
        }
      }, 100)
    }

    console.log('  🔁  ', `Branch change detected, from ${branch} to ${newBranch}`)

    branch = newBranch

    await onExit(stopSpring())

    console.log('\n')

    setTimeout(() => {
      globalLock = false
      branchCleaning = false
    }, 500)
  })

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  rl.on('SIGINT', () => {
    handleExit()
  })

  rl.on('line', (line) => {
    if (line.startsWith(':')) {
      handleTerminalCommand(line)
      return
    }

    if (childProcess) {
      childProcess.stdin.write(line+'\n')
    }

    rl.setPrompt('')
    rl.prompt(true)
  })

  rl.setPrompt('')
  rl.prompt(true)

  console.log('')

  console.log('  .______    __  .__   __.  __  ___      _______.')
  console.log('  |   _  \\  |  | |  \\ |  | |  |/  /     /       |')
  console.log('  |  |_)  | |  | |   \\|  | |  \'  /     |   (----`')
  console.log('  |   _  <  |  | |  . \`  | |    <       \\   \\    ')
  console.log('  |  |_)  | |  | |  |\\   | |  .  \\  .----)   |   ')
  console.log('  |______/  |__| |__| \\__| |__|\\__\\ |_______/    ')

  console.log('')
  console.log(`  Version ${VERSION} - https://github.com/calvinwalzel/binks`)
  console.log('')

  await onExit(stopSpring())

  console.log('  👀  ', `Watching for file changes in ${MONITORS.map(x => x.path).join(' & ')}`)

  console.log('\n')
}

// Clear terminal
process.stdout.write('\033c')

setup()

function buildCommands (files, relPath) {
  const commands = files.map((file) => {
    let args = []

    if (file.endsWith('.feature')) {
      args = [
        'exec',
        'spring',
        'cucumber',
        toTotalPath(file, relPath),
        '--color',
        '--no-source'
      ]
    }

    if (file.endsWith('_spec.rb')) {
      args = [
        'exec',
        'spring',
        'rspec',
        toTotalPath(file, relPath)
      ]
    }

    const command = {
      filePath: file,
      base: 'bundle',
      args: args
    }

    if (hasFeatureFocus(file, relPath)) {
      command.args.push('--tags')
      command.args.push('@focus')
      command.args.push('--fail-fast')

      focusCache = file
    } else if (hasSpecFocus(file, relPath)) {
      command.args.splice((command.args.length - 1), 0, '--tag')
      command.args.splice((command.args.length - 1), 0, 'focus')

      focusCache = file
    } else {
      if (focusCache !== null && focusCache === file) {
        focusCache = null

        console.log('-'.repeat(process.stdout.columns))
        console.log('  ⏩  ', 'Focus removed', command.filePath)
        console.log('-'.repeat(process.stdout.columns))

        return null
      }
    }

    return command
  })

  return commands.filter((command) => command !== null).filter((command) => command.args !== [])
}

function hasFeatureFocus (file, relPath) {
  if (!file.endsWith('.feature')) {
    return
  }

  const fileContent = fs.readFileSync(toTotalPath(file, relPath))

  return fileContent.includes('@focus')
}

function hasSpecFocus (file, relPath) {
  if (!file.endsWith('_spec.rb')) {
    return
  }

  const fileContent = fs.readFileSync(toTotalPath(file, relPath))

  return (fileContent.includes('focus: true') || fileContent.includes(':focus => true'))
}

function executeCommand (command) {
  console.log('-'.repeat(process.stdout.columns))
  console.log('  ⚠️  ', command.filePath)
  console.log('-'.repeat(process.stdout.columns))
  console.log('\n')

  const env = Object.create(process.env)

  // const childProcess = spawn(command.base, command.args, { env: env, stdio: ['pipe', 'inherit', 'inherit'] })
  const childProcess = spawn(command.base, command.args, { env: env, stdio: [null, 'inherit', 'inherit'] })

  childProcess.on('error', (error) => {
    console.log(`${error.message}`)
  })

  childProcess.on('close', code => {
    if (branchCleaning) {
      return
    }

    console.log(`  🏁  exit code ${code}`)
    console.log('\n')
  })

  return childProcess
}

function toTotalPath (filePath, relPath) {
  return path.resolve(process.cwd(), relPath + filePath)
}

function onExit (childProcess) {
  return new Promise((resolve, reject) => {
    childProcess.once('exit', (code, signal) => {
      resolve(undefined)
    })
    childProcess.once('error', (err) => {
      reject(err)
    })
  })
}

function stopSpring () {
  console.log('  🧽  ', 'Stopping spring...')

  return exec('bundle exec spring stop')
}

function handleTerminalCommand (command) {
  console.log('')

  command = command.replace(':', '')
  switch (command) {
    case 'quit':
    case 'exit':
      handleExit()
      break
    default:
      console.log('  ❓ ', 'Unknown command')
  }
  console.log('')
}

function handleExit () {
  if (childProcess) {
    childProcess.kill('SIGINT')
    // setTimeout(function () {
    //   childProcess.kill('SIGINT')
    // }, 100)
  } else {
    process.exit()
  }
}

function clearLastLine () {
  const ESC = '\x1b' // ASCII escape character
  const CSI = ESC + '[' // control sequence introducer

  process.stdout.write(CSI + 'A') // moves cursor up one line
  process.stdout.write(CSI + 'K') // clears from cursor to line end
}
