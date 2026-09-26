(function () {
  const drop = document.getElementById("drop");
  const input = document.getElementById("folderInput");
  const hint = document.getElementById("fileHint");
  const listEl = document.getElementById("fileList");
  const status = document.getElementById("status");
  const btn = document.getElementById("btn");
  const btnPick = document.getElementById("btnPick");
  const btnClear = document.getElementById("btnClear");

  let entries = [];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setEntries(items) {
    entries = items;
    if (!entries.length) {
      hint.textContent = "";
      listEl.innerHTML = "";
      return;
    }
    const top = entries[0].path.split("/")[0] || "資料夾";
    hint.textContent = "已選「" + top + "」· 共 " + entries.length + " 個檔案";
    let html = "";
    const n = Math.min(entries.length, 40);
    for (let i = 0; i < n; i++) {
      html += "<div>" + escapeHtml(entries[i].path) + "</div>";
    }
    if (entries.length > 40) {
      html += "<div>…還有 " + (entries.length - 40) + " 個</div>";
    }
    listEl.innerHTML = html;
  }

  function fromFileList(fileList) {
    const out = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const path = (f.webkitRelativePath || f.name || "").replace(/\\/g, "/");
      if (path) out.push({ file: f, path: path });
    }
    return out;
  }

  /** 去掉第一層資料夾名；若只有一層則整段當相對路徑 */
  function relInsideModel(fullPath) {
    const parts = fullPath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];
    return parts.slice(1).join("/");
  }

  function topFolderName(fullPath) {
    const parts = fullPath.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[0] || "encrypted_model";
  }

  function isModel3Json(name) {
    const n = name.replace(/\\/g, "/").toLowerCase();
    // 已是加密檔略過
    if (n.endsWith(".model3.json.enc")) return false;
    return n.endsWith(".model3.json");
  }

  function isMoc3(name) {
    const n = name.replace(/\\/g, "/").toLowerCase();
    if (n.endsWith(".moc3.enc")) return false;
    return n.endsWith(".moc3");
  }

  btnPick.addEventListener("click", function (e) {
    e.stopPropagation();
    input.click();
  });
  drop.addEventListener("click", function () {
    input.click();
  });
  input.addEventListener("change", function () {
    if (input.files && input.files.length) setEntries(fromFileList(input.files));
  });
  btnClear.addEventListener("click", function (e) {
    e.stopPropagation();
    input.value = "";
    setEntries([]);
    status.textContent = "已清除";
    status.className = "status";
  });

  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.remove("drag");
    });
  });

  drop.addEventListener("drop", async function (e) {
    const items = e.dataTransfer && e.dataTransfer.items;
    if (!items) return;
    status.textContent = "讀取資料夾中…";
    const collected = [];
    const tasks = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file") continue;
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) tasks.push(readEntry(entry, entry.name, collected));
    }
    try {
      await Promise.all(tasks);
      if (!collected.length) throw new Error("無法讀取，請用「選擇資料夾」");
      setEntries(collected);
      status.textContent = "已載入 " + collected.length + " 個檔案";
      status.className = "status ok";
    } catch (err) {
      status.textContent = err.message || String(err);
      status.className = "status err";
    }
  });

  function readEntry(entry, path, out) {
    return new Promise(function (resolve, reject) {
      if (entry.isFile) {
        entry.file(function (f) {
          out.push({ file: f, path: path.replace(/\\/g, "/") });
          resolve();
        }, reject);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const batch = function () {
          reader.readEntries(async function (ents) {
            if (!ents.length) return resolve();
            try {
              await Promise.all(
                ents.map(function (c) {
                  return readEntry(c, path + "/" + c.name, out);
                })
              );
              batch();
            } catch (err) {
              reject(err);
            }
          }, reject);
        };
        batch();
      } else resolve();
    });
  }

  btn.addEventListener("click", async function () {
    const pw = document.getElementById("pw").value;
    const pw2 = document.getElementById("pw2").value;
    if (!entries.length) {
      status.textContent = "請先選擇整個模型資料夾";
      status.className = "status err";
      return;
    }
    if (!pw) {
      status.textContent = "請輸入密碼";
      status.className = "status err";
      return;
    }
    if (pw !== pw2) {
      status.textContent = "兩次密碼不一致";
      status.className = "status err";
      return;
    }

    btn.disabled = true;
    status.textContent = "加密中…";
    status.className = "status";

    try {
      const zip = new JSZip();
      const folderName = topFolderName(entries[0].path);
      let hasJson = false;
      let hasMoc = false;
      const sampleNames = [];

      for (let i = 0; i < entries.length; i++) {
        const file = entries[i].file;
        const path = entries[i].path;
        // 同時用完整路徑與去掉頂層後的路徑判斷
        const rel = relInsideModel(path) || path.split("/").pop() || path;
        if (!rel) continue;

        const baseName = rel.split("/").pop() || rel;
        if (sampleNames.length < 15) sampleNames.push(baseName);

        const buf = new Uint8Array(await file.arrayBuffer());

        // 用「完整 path」與「rel」任一符合即可
        if (isModel3Json(path) || isModel3Json(rel) || isModel3Json(baseName)) {
          hasJson = true;
          zip.file(rel + ".enc", await L2DCrypto.encryptAssetBytes(buf, pw));
        } else if (isMoc3(path) || isMoc3(rel) || isMoc3(baseName)) {
          hasMoc = true;
          zip.file(rel + ".enc", await L2DCrypto.encryptAssetBytes(buf, pw));
        } else {
          zip.file(rel, buf);
        }

        if (i % 5 === 0) {
          status.textContent = "加密中… " + (i + 1) + "/" + entries.length;
        }
      }

      if (!hasJson || !hasMoc) {
        const hintList = sampleNames.length
          ? "目前掃到的檔名例如：\n" + sampleNames.join("\n")
          : "（沒有掃到任何檔名）";
        const missing = [];
        if (!hasJson) missing.push("*.model3.json");
        if (!hasMoc) missing.push("*.moc3");
        throw new Error(
          "找不到 " +
            missing.join(" 與 ") +
            "。\n請確認選的是「明文模型資料夾」（不要選已加密的）。\n\n" +
            hintList
        );
      }

      status.textContent = "打包 ZIP…";
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = folderName + "_encrypted.zip";
      a.click();
      URL.revokeObjectURL(a.href);
      status.textContent = "完成：已下載 ZIP";
      status.className = "status ok";
    } catch (e) {
      status.textContent = e.message || String(e);
      status.className = "status err";
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  });
})();
