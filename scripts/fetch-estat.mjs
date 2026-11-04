// e-Stat から薩摩川内市の人口動態（出生・死亡・転入・転出）を取得して data.json に書き込む
// 実行：ESTAT_APP_ID=xxxx node scripts/fetch-estat.mjs
// 外部ライブラリは使っていません（Node.js 18以上の標準機能だけで動きます）

import { readFile, writeFile } from "node:fs/promises";

const APP_ID = process.env.ESTAT_APP_ID;
if (!APP_ID) {
  console.error("ESTAT_APP_ID が設定されていません（GitHubの Secrets を確認してください）");
  process.exit(1);
}

// ===== 取得する内容 =====
const STATS_DATA_ID = "0000020201"; // 社会・人口統計体系 市区町村データ 基礎データ「A 人口・世帯」
const AREA_CODE = "46215";           // 鹿児島県薩摩川内市
const ITEMS = {
  births:  "A4101", // 出生数
  deaths:  "A4200", // 死亡数
  moveIn:  "A5101", // 転入者数
  moveOut: "A5102", // 転出者数
};
const FROM_YEAR = 2008; // この年以降を表示する

const DATA_FILE = new URL("../data.json", import.meta.url);

// ===== e-Stat API を呼ぶ =====
const url = new URL("https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData");
url.search = new URLSearchParams({
  appId: APP_ID,
  statsDataId: STATS_DATA_ID,
  cdArea: AREA_CODE,
  cdCat01: Object.values(ITEMS).join(","),
  metaGetFlg: "Y",
}).toString();

console.log(`e-Stat に問い合わせ中… statsDataId=${STATS_DATA_ID} area=${AREA_CODE}`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`通信エラー：HTTP ${res.status}`);
  process.exit(1);
}
const json = await res.json();
const root = json.GET_STATS_DATA;

// e-Stat 側のエラー（IDの間違いなど）
const status = Number(root?.RESULT?.STATUS);
if (status !== 0) {
  console.error(`e-Stat エラー（STATUS ${root?.RESULT?.STATUS}）：${root?.RESULT?.ERROR_MSG}`);
  process.exit(1);
}

// 項目名をログに出す（コードが正しいか確認するため）
const classObjs = [].concat(root.STATISTICAL_DATA?.CLASS_INF?.CLASS_OBJ ?? []);
const cat01 = classObjs.find(c => c["@id"] === "cat01");
for (const c of [].concat(cat01?.CLASS ?? [])) console.log(`  項目 ${c["@code"]}：${c["@name"]}`);

// ===== 値を年ごとに整理 =====
const values = [].concat(root.STATISTICAL_DATA?.DATA_INF?.VALUE ?? []);
console.log(`取得件数：${values.length}`);

const byYear = {}; // { 2020: { births: 600, ... } }
for (const v of values) {
  const key = Object.keys(ITEMS).find(k => ITEMS[k] === v["@cat01"]);
  const year = Number(String(v["@time"]).slice(0, 4));
  const n = Number(v["$"]);
  if (!key || !Number.isFinite(n) || year < FROM_YEAR) continue; // "-" や "***" は欠損として飛ばす
  (byYear[year] ??= {})[key] = n;
}

// 4項目すべてそろっている年だけを使う
const years = Object.keys(byYear).map(Number).sort((a, b) => a - b)
  .filter(y => Object.keys(ITEMS).every(k => byYear[y][k] !== undefined));

if (years.length === 0) {
  console.error("使えるデータが見つかりませんでした。上の項目一覧と取得件数を確認してください。");
  process.exit(1);
}

const dynamics = {
  source: "総務省「社会・人口統計体系（市区町村データ）」e-Stat API",
  unit: "人",
  years,
  births:  years.map(y => byYear[y].births),
  deaths:  years.map(y => byYear[y].deaths),
  moveIn:  years.map(y => byYear[y].moveIn),
  moveOut: years.map(y => byYear[y].moveOut),
};
console.log(`年：${years[0]}〜${years.at(-1)}（${years.length}年分）`);

// ===== data.json を更新（変化があったときだけ） =====
const data = JSON.parse(await readFile(DATA_FILE, "utf8"));
const before = JSON.stringify(data.population.dynamics ?? null);
const after = JSON.stringify(dynamics);

if (before === after) {
  console.log("データに変化はありません。data.json はそのままにします。");
} else {
  data.population.dynamics = dynamics;
  data.updated = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // YYYY-MM-DD
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
  console.log("data.json を更新しました。");
}
