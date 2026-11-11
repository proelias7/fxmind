"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const dotenv = require("dotenv");
const { spawnSync } = require("node:child_process");
const { GLOBAL_ROOT } = require("./global-store");

const CONFIG_FILE = path.join(GLOBAL_ROOT, "jev.env");

function readConfig(file = CONFIG_FILE) {
  try { return dotenv.parse(fs.readFileSync(file)); }
  catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error("Não foi possível ler a configuração local da Jev.");
  }
}

function validKey(value) {
  return Boolean(String(value || "").trim()) && !/[\r\n\0]/.test(value) && value.length <= 4096;
}

async function promptJevSetup({ optional = false, file = CONFIG_FILE, prompts } = {}) {
  const { confirm, password } = prompts || await import("@inquirer/prompts");
  if (optional && !await confirm({ message: "Configurar a Jev AI agora? (padrão do usuário para seus projetos)", default: false })) return null;
  const previous = readConfig(file);
  if (previous.FXMIND_JEV_API_KEY && await confirm({ message: "Manter a chave da Jev já configurada?", default: true })) {
    return { apiKey: previous.FXMIND_JEV_API_KEY };
  }
  const apiKey = await password({
    message: "Chave da API da Jev (entrada oculta):", mask: "*",
    validate: (value) => validKey(value) || "Informe uma chave válida, sem quebras de linha.",
  });
  if (!validKey(apiKey)) throw new Error("Chave da Jev inválida.");
  return { apiKey: apiKey.trim() };
}

function saveJevSetup(setup, file = CONFIG_FILE) {
  if (!setup || !validKey(setup.apiKey)) throw new Error("Chave da Jev inválida.");
  try {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error("symlink");
    const values = { ...readConfig(file), FXMIND_JEV_ENABLED: "true", FXMIND_JEV_API_KEY: setup.apiKey };
    const content = Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n";
    if (dotenv.parse(content).FXMIND_JEV_API_KEY !== setup.apiKey) throw new Error("encoding");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", path.basename(file)], {
      cwd: path.dirname(file), stdio: "ignore", windowsHide: true,
    });
    if (tracked.status === 0) throw new Error("tracked configuration");
    const ignoreFile = path.join(path.dirname(file), ".gitignore");
    const ignored = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8") : "";
    if (!ignored.split(/\r?\n/).includes("/" + path.basename(file))) {
      fs.appendFileSync(ignoreFile, (ignored.endsWith("\n") || !ignored ? "" : "\n") + "/" + path.basename(file) + "\n");
    }
    const tmp = file + "." + crypto.randomUUID() + ".tmp";
    try {
      fs.writeFileSync(tmp, content, { mode: 0o600, flag: "wx" });
      fs.renameSync(tmp, file);
    } finally { try { fs.unlinkSync(tmp); } catch {} }
    return { enabled: true, configured: true };
  } catch { throw new Error("Não foi possível salvar a configuração local da Jev."); }
}

async function runJevCli(argv) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    console.log("fxmind jev — configura a Jev AI; a chave é pedida com entrada oculta no terminal.");
    return 0;
  }
  if (argv.length || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Abra um terminal interativo e execute fxmind jev. Não passe a chave por argumentos ou pelo chat.");
    return 1;
  }
  try {
    saveJevSetup(await promptJevSetup());
    console.log("Jev configurada. Reinicie o agente/MCP. Configurações do projeto e do ambiente têm prioridade.");
    return 0;
  } catch (error) {
    if (["ExitPromptError", "AbortPromptError", "CancelPromptError"].includes(error.name)) {
      console.log("Configuração cancelada.");
      return 0;
    }
    throw error;
  }
}

module.exports = { CONFIG_FILE, promptJevSetup, saveJevSetup, runJevCli };
