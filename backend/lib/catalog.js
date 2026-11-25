// 品項目錄與各來源欄位對照。
// verified:false 代表「尚未用官方原始檔核對過欄位名稱」，正式資料匯入時若找不到欄位會列入報告，不會自行猜測。

export const PRICE_TYPES = {
  retail:      { label: '菜市場訪價', short: '訪價' },
  wholesale:   { label: '批發行情',   short: '批發' },
  hog_auction: { label: '毛豬拍賣',   short: '拍賣' },
  poultry:     { label: '家禽行情',   short: '家禽' },
};

export const CATEGORIES = { veg: '蔬菜', seafood: '海鮮', meat: '肉品' };

// taichung: 84539 寬表欄位名（取自資料集「主要欄位說明」）
// veg / fish: 批發「作物名稱／魚貨名稱」比對規則（prefix 或 includes）
export const ITEMS = [
  // 蔬菜
  { id: 'cabbage',     name: '高麗菜', cat: 'veg', img: 'cabbage', alias: ['甘藍','高麗'], taichung: ['甘藍(平地高麗菜)'], veg: { prefix: '甘藍' } },
  { id: 'scallion',    name: '青蔥',   cat: 'veg', alias: ['蔥'], taichung: ['青蔥'], veg: { prefix: '青蔥' } },
  { id: 'cauliflower', name: '花椰菜', cat: 'veg', alias: ['花菜','青花菜'], taichung: ['花椰菜'], veg: { prefix: '花椰菜' } },
  { id: 'bokchoy',     name: '青江菜', cat: 'veg', alias: ['青江白菜','湯匙菜'], taichung: ['青江白菜'], veg: { prefix: '青江白菜' } },
  { id: 'kangkong',    name: '空心菜', cat: 'veg', alias: ['蕹菜'], taichung: ['蕹菜(空心菜)'], veg: { prefix: '蕹菜' } },
  { id: 'carrot',      name: '紅蘿蔔', cat: 'veg', alias: ['胡蘿蔔'], taichung: ['胡蘿蔔'], veg: { prefix: '胡蘿蔔' } },
  { id: 'onion',       name: '洋蔥',   cat: 'veg', alias: [], taichung: ['洋蔥(內銷)'], veg: { prefix: '洋蔥' } },
  { id: 'luffa',       name: '絲瓜',   cat: 'veg', alias: [], taichung: ['絲瓜'], veg: { prefix: '絲瓜' } },
  // 海鮮
  { id: 'whiteshrimp', name: '白蝦',   cat: 'seafood', img: 'shrimp', alias: ['蝦'], taichung: ['白蝦'], fish: { includes: '白蝦' } },
  { id: 'clam',        name: '文蛤',   cat: 'seafood', alias: ['蛤蜊','蚌'], taichung: ['文蛤'], fish: { includes: '文蛤' } },
  { id: 'milkfish',    name: '虱目魚', cat: 'seafood', alias: [], taichung: ['虱目魚'], fish: { includes: '虱目魚' } },
  { id: 'barramundi',  name: '金目鱸', cat: 'seafood', alias: ['鱸魚'], taichung: ['金目鱸'], fish: { includes: '金目鱸' } },
  { id: 'tilapia',     name: '吳郭魚', cat: 'seafood', alias: ['台灣鯛'], taichung: ['吳郭魚'], fish: { includes: '吳郭魚' } },
  { id: 'threadfin',   name: '午仔魚', cat: 'seafood', alias: [], taichung: ['午仔魚'], fish: { includes: '午仔' } },
  // 肉品（零售部位與活體分開）
  { id: 'porkbelly',   name: '五花肉', cat: 'meat', img: 'pork_belly', alias: ['三層肉'], taichung: ['五花肉'] },
  { id: 'porkloin',    name: '里肌肉', cat: 'meat', alias: [], taichung: ['里肌肉'] },
  { id: 'porkham',     name: '豬後腿肉', cat: 'meat', alias: ['後腿肉'], taichung: ['後腿肉'] },
  { id: 'beefshank',   name: '冷凍牛腱', cat: 'meat', alias: ['牛腱'], taichung: ['牛腱(冷凍牛肉)'] },
  { id: 'chicken',     name: '肉雞',   cat: 'meat', alias: ['雞'], taichung: ['肉雞'] },
  { id: 'nativechicken', name: '土雞', cat: 'meat', alias: ['雞'], taichung: ['土雞'] },
  { id: 'livehog',     name: '毛豬', cat: 'meat', alias: ['活豬','豬'], hog: true },
  { id: 'broiler',     name: '白肉雞', cat: 'meat', alias: ['白肉雞','雞'], poultry: true },
];

export const itemById = Object.fromEntries(ITEMS.map(i => [i.id, i]));
