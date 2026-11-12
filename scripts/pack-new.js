/**
 * fxmind pack new <id> — scaffold a new knowledge pack under packs/<id>/.
 *
 * Developer command: creates pack.json + templates/ + an optional skills repo
 * placeholder, so adding a pack is not a manual process.
 */

const fs = require("fs");
const path = require("path");

const { PACKAGE_ROOT, PACKS_DIR, listPackIds, getPack, externalPacksDir } = require("./packs");
const { runPackAdd, runPackRemove, readSources } = require("./pack-add");

function slugify(id) {
  return String(id)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createPackScaffold(packId, options = {}) {
  const id = slugify(packId);
  if (!id) {
    throw new Error("Invalid pack id: use lowercase letters, digits, hyphens.");
  }

  if (listPackIds().includes(id) && !options.force) {
    throw new Error(`Pack "${id}" already exists at packs/${id}. Use --force to overwrite templates only.`);
  }

  const packDir = path.join(PACKS_DIR, id);
  const templatesDir = path.join(packDir, "templates");
  fs.mkdirSync(templatesDir, { recursive: true });

  const manifest = {
    id,
    label: options.label || id,
    description: options.description || `${id} knowledge pack`,
    skills: {
      repo: options.repo || `https://github.com/<org>/${id}-skill.git`,
      cacheName: options.cacheName || `${id}-skill`,
      siblingPath: `../${id}-skill/skills`,
    },
    defaultSkills: options.defaultSkills || [],
    templateFiles: options.templateFiles || [
      { src: "topic-catalog.md", dest: "policy/topic-catalog.md" },
    ],
  };

  fs.writeFileSync(
    path.join(packDir, "pack.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  // Seed a minimal pack template so the pack is usable immediately.
  const topicCatalog = path.join(templatesDir, "topic-catalog.md");
  if (!fs.existsSync(topicCatalog)) {
    fs.writeFileSync(
      topicCatalog,
      `# ${id} topic catalog\n\n| Tópico | Triggers | Search hints |\n| --- | --- | --- |\n| \`example\` | example, demo | \`\`\` |\n`,
      "utf8",
    );
  }

  return {
    packDir: path.relative(PACKAGE_ROOT, packDir).replace(/\\/g, "/"),
    manifestPath: path.relative(PACKAGE_ROOT, path.join(packDir, "pack.json")).replace(/\\/g, "/"),
    templatesDir: path.relative(PACKAGE_ROOT, templatesDir).replace(/\\/g, "/"),
  };
}

function printPackHelp() {
  console.log(`fxmind pack — manage knowledge packs.

Usage:
  fxmind pack add <source> [options]      Install a pack from owner/repo, a git URL or a local folder
  fxmind pack remove <id> [--force]       Remove a pack installed with pack add
  fxmind pack list                         List available packs and where they come from
  fxmind pack new <id> [options]          Scaffold a new pack under packs/<id>/
  fxmind pack -h                           This help

Options for \`pack add\`:
  --ref <branch|tag>        Clone that branch or tag
  --path <folder>           The pack sits in this folder of the repository
  --force                   Overwrite an installed pack with the same id without asking

Options for \`pack new\`:
  --label <text>            Pack label (default: id)
  --description <text>      Pack description
  --repo <url>              Skills git repo URL
  --cache-name <name>       Skills cache folder name (default: <id>-skill)
  --default-skills <list>   Comma-separated default skill names
  --force                   Overwrite templates if pack exists (keeps pack.json unless missing)

Examples:
  fxmind pack add my-org/fxmind-pack-laravel
  fxmind pack add https://gitlab.com/my-org/packs.git --path laravel --ref v1.2.0
  fxmind pack new qbox --label Qbox --repo https://github.com/org/qbox-skill.git --default-skills qbox-framework`);
}

function parsePackCliArgs(argv) {
  const options = {
    label: null,
    description: null,
    repo: null,
    cacheName: null,
    defaultSkills: [],
    templateFiles: [],
    force: false,
    help: false,
    positional: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--label") {
      options.label = argv[++i];
    } else if (arg === "--description") {
      options.description = argv[++i];
    } else if (arg === "--repo") {
      options.repo = argv[++i];
    } else if (arg === "--cache-name") {
      options.cacheName = argv[++i];
    } else if (arg === "--default-skills") {
      options.defaultSkills = (argv[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === "--force") {
      options.force = true;
    } else if (!arg.startsWith("-")) {
      options.positional.push(arg);
    }
  }

  return options;
}

function runPackCli(argv = []) {
  const sub = argv[0];

  if (sub === "-h" || sub === "--help" || !sub) {
    printPackHelp();
    return sub ? 1 : 0;
  }

  if (sub === "add") return runPackAdd(argv.slice(1));
  if (sub === "remove" || sub === "rm") return runPackRemove(argv.slice(1));

  if (sub === "list") {
    const ids = listPackIds();
    if (ids.length === 0) {
      console.log("No packs found.");
    } else {
      const sources = readSources(externalPacksDir());
      console.log("Available packs:");
      for (const id of ids) {
        const pack = getPack(id);
        console.log(`  - ${id}${pack.source === "external" ? `  (from ${sources[id]?.source || externalPacksDir()})` : ""}`);
      }
    }
    return 0;
  }

  if (sub === "new") {
    const options = parsePackCliArgs(argv.slice(1));
    if (options.help) {
      printPackHelp();
      return 0;
    }
    const id = options.positional[0];
    if (!id) {
      console.error("Error: `pack new` requires an id. Example: fxmind pack new qbox");
      return 1;
    }
    try {
      const result = createPackScaffold(id, options);
      console.log(`Created pack: ${result.packDir}`);
      console.log(`  manifest  → ${result.manifestPath}`);
      console.log(`  templates → ${result.templatesDir}`);
      console.log("Edit pack.json (skills repo, defaultSkills, templateFiles) and add skills.");
      return 0;
    } catch (error) {
      console.error(`Error: ${error.message}`);
      return 1;
    }
  }

  printPackHelp();
  return 1;
}

module.exports = {
  slugify,
  createPackScaffold,
  runPackCli,
};
