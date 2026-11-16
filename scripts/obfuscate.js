const fs = require("fs");
const path = require("path");

const XOR_KEY = 0x4f;

function encodeStringToTable(str, key) {
  const bytes = new TextEncoder().encode(str);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] ^ (key ^ (i % 11)));
  }
  return btoa(out);
}

function evaluateTemplateRawChunk(raw) {
  try {
    return new Function("return `" + raw.replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`;")();
  } catch (e) {
    return raw;
  }
}

function obfuscateCode(code) {
  const stringTable = [];
  const stringIndexMap = new Map();

  function getOrAddString(strContent) {
    if (stringIndexMap.has(strContent)) return stringIndexMap.get(strContent);
    const idx = stringTable.length;
    stringTable.push(encodeStringToTable(strContent, XOR_KEY));
    stringIndexMap.set(strContent, idx);
    return idx;
  }

  const lines = code.split("\n");
  const importLines = [];
  const bodyLines = [];

  for (const line of lines) {
    if (/^import\s+[\s\S]*?;?$/.test(line.trim())) {
      importLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }

  const bodyCode = bodyLines.join("\n");
  const len = bodyCode.length;

  function processCode(source, start = 0, end = len) {
    let i = start;
    let out = "";

    function isRegexAt(idx, currentOutput) {
      const trimmed = currentOutput.trimEnd();
      const lastChar = trimmed.slice(-1);
      return !lastChar || "(=:[,!&|?;{}~^+*%-".includes(lastChar) || /(?:return|case|delete|throw|typeof)\s*$/.test(trimmed);
    }

    while (i < end) {
      const char = source[i];
      const nextChar = i + 1 < end ? source[i + 1] : "";

      if (char === "/" && nextChar === "/") {
        const nextNl = source.indexOf("\n", i);
        const commentEnd = (nextNl === -1 || nextNl > end) ? end : nextNl;
        out += source.slice(i, commentEnd);
        i = commentEnd;
        continue;
      }

      if (char === "/" && nextChar === "*") {
        const nextStar = source.indexOf("*/", i + 2);
        const commentEnd = (nextStar === -1 || nextStar + 2 > end) ? end : nextStar + 2;
        out += source.slice(i, commentEnd);
        i = commentEnd;
        continue;
      }

      if (char === "/") {
        if (isRegexAt(i, out)) {
          let k = i + 1;
          let inClass = false;
          while (k < end) {
            if (source[k] === "\\") k += 2;
            else if (source[k] === "[" && !inClass) { inClass = true; k++; }
            else if (source[k] === "]" && inClass) { inClass = false; k++; }
            else if (source[k] === "/" && !inClass) {
              k++;
              while (k < end && /[gimsuy]/.test(source[k])) k++;
              break;
            } else k++;
          }
          out += source.slice(i, k);
          i = k;
          continue;
        }
      }
  
      if (char === '"' || char === "'") {
        const quote = char;
        const strStart = i;
        let strEnd = i + 1;

        while (strEnd < end) {
          if (source[strEnd] === "\\") strEnd += 2;
          else if (source[strEnd] === quote) { strEnd++; break; }
          else if (source[strEnd] === "\n") break;
          else strEnd++;
        }

        const strLiteral = source.slice(strStart, strEnd);
        let rawVal = null;
        try {
          rawVal = quote === '"'
            ? JSON.parse(strLiteral)
            : JSON.parse(`"${strLiteral.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
        } catch {
          rawVal = strLiteral.slice(1, -1);
        }

        const prevTrimmed = out.trimEnd();
        const isImportExport = /(?:from|import)\s*$/.test(prevTrimmed);
        const isDirective = rawVal === "use strict";

        if (isImportExport || isDirective || !rawVal || rawVal.length === 0) {
          out += strLiteral;
          i = strEnd;
          continue;
        }

        let k = strEnd;
        while (k < end && (source[k] === " " || source[k] === "\t" || source[k] === "\r" || source[k] === "\n")) k++;
        const isFollowedByColon = (source[k] === ":" && source[k + 1] !== ":");
        const lastToken = prevTrimmed.slice(-1);
        const isTernaryOrCondition = lastToken === "?" || /(?:case)\s*$/.test(prevTrimmed);

        if (isFollowedByColon && !isTernaryOrCondition) {
          out += strLiteral;
        } else {
          const idx = getOrAddString(rawVal);
          out += `_0x_dec_fn(${idx})`;
        }

        i = strEnd;
        continue;
      }

      if (char === "`") {
        let k = i + 1;
        const parts = [];
        let rawChunk = "";

        while (k < end) {
          const c = source[k];
          if (c === "\\") {
            rawChunk += source.slice(k, k + 2);
            k += 2;
          } else if (c === "`") {
            if (rawChunk.length > 0) {
              const val = evaluateTemplateRawChunk(rawChunk);
              if (val.length > 0) {
                const idx = getOrAddString(val);
                parts.push(`_0x_dec_fn(${idx})`);
              }
            }
            k++;
            break;
          } else if (c === "$" && source[k + 1] === "{") {
            if (rawChunk.length > 0) {
              const val = evaluateTemplateRawChunk(rawChunk);
              if (val.length > 0) {
                const idx = getOrAddString(val);
                parts.push(`_0x_dec_fn(${idx})`);
              }
              rawChunk = "";
            }
            k += 2;

            let depth = 1;
            const exprStart = k;

            while (k < end && depth > 0) {
              const ec = source[k];
              const enc = k + 1 < end ? source[k + 1] : "";

              if (ec === "/" && enc === "/") {
                const nextNl = source.indexOf("\n", k);
                k = nextNl === -1 ? end : nextNl;
                continue;
              }
              if (ec === "/" && enc === "*") {
                const nextStar = source.indexOf("*/", k + 2);
                k = nextStar === -1 ? end : nextStar + 2;
                continue;
              }
              if (ec === '"' || ec === "'") {
                const eq = ec;
                k++;
                while (k < end) {
                  if (source[k] === "\\") k += 2;
                  else if (source[k] === eq) { k++; break; }
                  else if (source[k] === "\n") break;
                  else k++;
                }
                continue;
              }
              if (ec === "`") {
                k++;
                let nestedDepth = 0;
                while (k < end) {
                  if (source[k] === "\\") k += 2;
                  else if (source[k] === "`" && nestedDepth === 0) { k++; break; }
                  else if (source[k] === "$" && source[k + 1] === "{") {
                    nestedDepth++;
                    k += 2;
                  } else if (source[k] === "}" && nestedDepth > 0) {
                    nestedDepth--;
                    k++;
                  } else {
                    k++;
                  }
                }
                continue;
              }
              if (ec === "/") {
                const subOut = source.slice(exprStart, k);
                if (isRegexAt(k, subOut)) {
                  k++;
                  let inClass = false;
                  while (k < end) {
                    if (source[k] === "\\") k += 2;
                    else if (source[k] === "[" && !inClass) { inClass = true; k++; }
                    else if (source[k] === "]" && inClass) { inClass = false; k++; }
                    else if (source[k] === "/" && !inClass) {
                      k++;
                      while (k < end && /[gimsuy]/.test(source[k])) k++;
                      break;
                    } else k++;
                  }
                  continue;
                }
              }
              if (ec === "{") {
                depth++;
                k++;
                continue;
              }
              if (ec === "}") {
                depth--;
                if (depth === 0) {
                  const exprCode = source.slice(exprStart, k);
                  const processedExpr = processCode(exprCode, 0, exprCode.length);
                  parts.push(`(${processedExpr})`);
                  k++;
                  break;
                }
                k++;
                continue;
              }
              k++;
            }
          } else {
            rawChunk += c;
            k++;
          }
        }

        if (parts.length === 0) {
          const emptyIdx = getOrAddString("");
          out += `_0x_dec_fn(${emptyIdx})`;
        } else if (parts.length === 1) {
          out += parts[0];
        } else {
          out += "(" + parts.join(" + ") + ")";
        }

        i = k;
        continue;
      }

      out += char;
      i++;
    }

    return out;
  }

  const processedBody = processCode(bodyCode);

  const runtimeHeader = `// @ts-nocheck
const _0x_key = ${XOR_KEY};
const _0x_tbl = ${JSON.stringify(stringTable)};
const _0x_cache = new Map();
const _0x_dec = new TextDecoder();
function _0x_dec_fn(idx) {
  if (_0x_cache.has(idx)) return _0x_cache.get(idx);
  const raw = atob(_0x_tbl[idx]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i) ^ (_0x_key ^ (i % 11));
  }
  const out = _0x_dec.decode(bytes);
  _0x_cache.set(idx, out);
  return out;
}
`;
  const importsHeader = importLines.length > 0 ? importLines.join("\n") + "\n" : "";
  const cleanedOutput = processedBody.replace(/\/\/#\s*sourceMappingURL=.*$/gm, "");
  return importsHeader + runtimeHeader + "\n" + cleanedOutput;
}

function inlineAssets(code, baseDir) {
  return code.replace(/import\s+(\w+)\s+from\s+["\x27]([^"\x27]*\.(?:b64|html))["\x27];?/g, (match, varName, relPath) => {
    let assetPath = path.resolve(baseDir, relPath);
    if (!fs.existsSync(assetPath)) {
      const srcFallback = path.resolve(__dirname, "../src", path.basename(relPath));
      if (fs.existsSync(srcFallback)) {
        assetPath = srcFallback;
      }
    }
    if (fs.existsSync(assetPath)) {
      const content = fs.readFileSync(assetPath, "utf8").trim();
      return `const ${varName} = ${JSON.stringify(content)};`;
    }
    return match;
  });
}

function minifyBundle(filePath) {
  try {
    const esbuildPath = require.resolve("esbuild", {
      paths: [process.cwd(), __dirname, ...module.paths],
    });
    if (esbuildPath) {
      const esbuild = require(esbuildPath);
      const code = fs.readFileSync(filePath, "utf8");
      const result = esbuild.transformSync(code, {
        minifyIdentifiers: true,
        minifySyntax: true,
        minifyWhitespace: false,
        target: "es2022",
        format: "esm",
      });
      if (result && result.code) {
        fs.writeFileSync(filePath, result.code, "utf8");
        console.log("Identifiers and syntax minified successfully via esbuild.");
      }
    }
  } catch (err) {
    try {
      const { execFileSync } = require("child_process");
      execFileSync("npx", [
        "esbuild",
        filePath,
        "--bundle=false",
        "--minify-identifiers",
        "--minify-syntax",
        "--target=es2022",
        `--outfile=${filePath}`,
        "--allow-overwrite",
      ], { stdio: "inherit" });
      console.log("Identifiers and syntax minified via npx esbuild.");
    } catch (e) {
      console.warn("esbuild minification skipped:", e.message);
    }
  }
}

function main() {
  const targetFile = process.argv[2] || path.join(__dirname, "../dist/index.js");
  if (!fs.existsSync(targetFile)) {
    console.error(`Target file non-existent: ${targetFile}`);
    process.exit(1);
  }

  let code = fs.readFileSync(targetFile, "utf8");
  console.log(`Inlining assets and obfuscating ${targetFile} (${code.length} bytes)...`);

  code = inlineAssets(code, path.dirname(targetFile));

  const obfuscated = obfuscateCode(code);
  fs.writeFileSync(targetFile, obfuscated, "utf8");

  minifyBundle(targetFile);

  const mapFile = `${targetFile}.map`;
  if (fs.existsSync(mapFile)) {
    fs.rmSync(mapFile, { force: true });
  }

  const finalCode = fs.readFileSync(targetFile, "utf8");

  const rootWorkerPath = path.join(__dirname, "../worker.js");
  fs.writeFileSync(rootWorkerPath, finalCode, "utf8");
  console.log(`Also generated root worker at ${rootWorkerPath}`);

  console.log(`Obfuscated successfully (${finalCode.length} bytes).`);
}

main();
