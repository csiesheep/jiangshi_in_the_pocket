# -*- coding: utf-8 -*-
"""The 繁體中文 overlay, batch 1: the game and the landing page.

Register follows the English, which is spare, concrete and grim, and never
explains itself. So: short sentences, plain nouns, no 成語 reaching for weight
the English does not have, and nothing softened. Where English understates, the
Chinese understates.

Naming is the vault glossary, not invention. 中毒 is the STATE and 屍毒 the
SUBSTANCE, and they are not interchangeable.

NOT the source of truth any more. The zh file has been edited directly for
many issues since this ran, so this script is 59 keys behind it and would
delete them; the write at the bottom refuses when that is true. Read that
comment before adding anything here.

§9 binds identically here: no threshold anywhere, no kit list, and the only
place either number lives is the two labels on the King's card.
"""
import io, json, collections, os

BASE = r"C:\Users\sheep\code\jiangshi_in_the_pocket-fe\data\theme.json"
OUT = r"C:\Users\sheep\code\jiangshi_in_the_pocket-fe\data\theme.zh-TW.json"
en = json.load(io.open(BASE, encoding="utf-8"), object_pairs_hook=collections.OrderedDict)

o = collections.OrderedDict()
o["_note"] = ("繁體中文 overlay, merged over data/theme.json key by key (see js/lang.js). "
              "Register follows the English: spare, concrete, grim, nothing over-explained. "
              "Naming follows the vault glossary — 中毒 is the state, 屍毒 the substance. "
              "§9 binds here identically: the threshold appears nowhere but the two labels "
              "on the King's verdict card, and no kit list appears at all.")

o["title"] = "三更：殭屍"
o["tagline"] = "夜裡九點。三更時分，他來找你。"
o["words"] = {"monsters": "殭屍", "relic": "神主牌"}

# ---- The nouns ---------------------------------------------------------------
# BROKEN ON PURPOSE, 2026-08-27, AND LEFT THAT WAY LOUDLY.
#
# This used to read: "Every name already carries its Chinese form followed by an
# English gloss; the gloss exists so an English player gets the flavour. In
# Chinese it is the same word twice, so it goes." That was true and it is not
# true any more. The ruling "In English mode, remove all traditional Chinese"
# took the Chinese OUT of the English theme, so there is no longer a Chinese
# form in there to keep and an English gloss to drop.
#
# THE DIRECTION OF DERIVATION INVERTED. The English file was the source and the
# Chinese names were struck from it; now the Chinese file is the only place
# those names exist. Running this today would have taken "Cinnabar" and produced
# "Cinnabar" as the Chinese name for 硃砂 -- not a crash, not an empty string,
# just thirteen English item names quietly written into the Chinese theme.
#
# So it raises instead. The header already said this file is not the source of
# truth and is 59 keys behind; this is the point at which that stopped being a
# caveat and became a fact that will corrupt the file it writes.
def strip_gloss(section):
    NL = chr(10)
    raise SystemExit(NL.join([
        "make_zh.py cannot build " + section + " any more.",
        "The English theme no longer carries Chinese names to strip a gloss from,",
        "so this would copy English names into the Chinese file without failing.",
        "The Chinese theme is now the SOURCE for names, not the derivative: edit",
        "data/theme.zh-TW.json directly, and rewrite this script the other way",
        "round if a generator is wanted again.",
    ]))

for section in ["tiles", "items", "categories", "eventNames", "actions", "setting"]:
    o[section] = strip_gloss(section)

# king keeps its two card labels, which are the one §9 exception and must read
# as a measurement rather than a boast.
o["king"] = collections.OrderedDict(strip_gloss("king"))
o["king"]["yours"] = "你的攻擊力"
o["king"]["needed"] = "需要"

o["tileBlurbs"] = collections.OrderedDict([
    ("gatehouse", "起點。三條路往裡走，門在你身後關上了。"),
    ("apothecary", "一道門。幾櫃藥材、一桿秤，藥臼裡還有東西。"),
    ("woodshed", "竹竿和斧頭，離門口很近。"),
    ("sutra-hall", "經卷和符咒。全村最厚的一份法力。"),
    ("mourning-hall", "停靈的地方，兩幅白幡底下。"),
    ("courtyard", "十字路口。沒有頂，月門是唯一通到外面的路。"),
    ("blacksmith", "一道門。爐子——鐵屬陽，炭還沒滅。"),
    ("counting-room", "帳冊、算盤，桌子後面是帳房自己的藥箱。"),
    ("incense-hall", "一層層的牌位。有一盤香還燒著，只燒這一次。"),
    ("sealed-crypt", "沒人來認的那口棺材，用紙封死了。神主牌在裡面。"),
    ("back-steps", "月門外的石階平台。"),
    ("dry-well", "村子把不要的東西丟進去的地方。"),
    ("bamboo-grove", "竹竿，上面繫著紙符。"),
    ("memorial-arch", "供品和工具堆在腳下。"),
    ("pavilion", "可以坐一下的地方，如果今晚是別的晚上。"),
    ("pagoda-tree", "鬼樹。它能治傷，因為它本來就是藥。"),
    ("stone-ward", "路口那塊石頭。外面每條路都要經過它。"),
    ("stream", "溪澗。水流過石頭。這裡沒有東西可找，也留不住你。"),
    ("earth-god-shrine", "土地公知道死人埋在哪裡。問一次。"),
    ("mass-grave", "無主的坑。把神主牌埋回這裡。"),
])

o["itemBlurbs"] = collections.OrderedDict([
    # Not an item: the 神主牌 has no entry in items.json on purpose. It is
    # keyed here because the equipment slot and the reveal panel both read
    # itemBlurbs under "relic", and a line only in the generated file would
    # be dropped the next time this ran.
    ("relic", "死者的名字，刻在木上。把它帶回去，屍身才有地方可以喊回來。"),
    ("precept-knife", "和尚的刀，本來只用來裁布割繩。還是一直磨著。"),
    ("peachwood-sword", "桃木不好開鋒，卻很吃得住邪。"),
    ("coin-sword", "舊錢串在鐵線骨上。上面的皇帝都死了，要的就是這個。"),
    ("sevenstar-sword", "北斗嵌在劍身上。全村最好的鐵，而且它知道。"),
    ("truefire-talisman", "黃紙紅字。一沾就燒，也能把火借給一把劍。"),
    ("fivethunder-talisman", "五道雷，摺得很小。你只有一張，而它很大。"),
    ("blood-talisman", "用你自己的血寫。要多少就是多少。"),
    ("cinnabar", "磨好的紅礦。一道符畫兩次，就靈兩次。"),
    ("soul-banner", "本來該是道士拿的幡。在你手上，一把劍當兩把用。"),
    ("sticky-rice", "把屍毒從傷口裡吸出來。也能填肚子，到十一點就知道差別。"),
    ("black-dog-blood", "潑出去，換一個門口。跟殭屍王換不到任何東西。"),
    ("golden-elixir", "這種丹，有一半是懂行的人煉的。"),
    ("protective-charm", "縫死了貼身戴著。每一下都先由它挨。"),
])

o["events"] = collections.OrderedDict([
    ("JIANGSHI", {"9": "暗處有東西直起身子，跳了一下。",
                  "10": "他們循著聲音過來，腿是直的，不急。",
                  "11": "屋裡都是他們。他們不再假裝自己是傢俱了。"}),
    ("HP_LOSS", {"9": "黑裡踩空一步。還是要付代價。",
                 "10": "有東西擦著你的臉過去，帶走一塊皮。",
                 "11": "這裡的冷會咬人，連氣一起咬走。"}),
    ("HP_GAIN", {"9": "乾淨的水，還有夠你喝完的一點時間。",
                 "10": "你找到一面牆靠著，把氣喘勻了。",
                 "11": "一小截香，還是溫的。你坐到它燒完。"}),
    ("NOTHING", {"9": "地板沉了一下。沒有下文。",
                 "10": "灰塵，還有你自己的腳步聲。",
                 "11": "安靜，和陳年雨水的味道。"}),
    ("POISON", {"9": "一根釘子刮到你。傷口邊上發灰。",
                "10": "冰冷的手指擦過你的手腕，那股冷留下來了。",
                "11": "屍毒已經進了血裡。你感覺得到它在找你的心臟。"}),
    ("VILLAGER", {"9": "這裡還有人活著，而且受了傷。",
                  "10": "一個村民，被逼到角落，還沒死。",
                  "11": "有人在喊。還來得及。"}),
])

o["villager"] = collections.OrderedDict([
    ("ask", "你身上有糯米。給出去，他們也許還能活。"),
    ("give", "把糯米給他"),
    ("refuse", "自己留著"),
    ("gave", "他們接過去，把{gift}塞進你手裡，就不見了。"),
    ("refused", "你把糯米留下了。追他們的東西現在在你面前。"),
])

o["poison"] = collections.OrderedDict([
    ("state", "中毒"),
    ("onset", "屍毒。它不會自己停。"),
    ("tick", "皮膚底下的灰又往前爬了一點。"),
    ("cured", "糯米把它吸出來了。手又是你自己的了。"),
])

# The two wins are held to the same register AND near enough the same length in
# Chinese as in English — the seal is the hidden ending, not the better one, and
# a longer sentence would be the game congratulating you for finding it.
o["outcomes"] = collections.OrderedDict([
    # Four endings since #59 retired 見到天亮 with the rule that reached it.
    ("WIN_BURIAL", "下葬"), ("WIN_SEAL", "鎮屍"),
    ("LOSS_HEALTH", "傷重不治"), ("LOSS_KING", "王帶走了你"),
    ("subs", collections.OrderedDict([
        ("WIN_BURIAL", "天亮以前，你把土填回去了。"),
        ("WIN_SEAL", "從那以後，他沒有再往前一步。"),
        ("LOSS_KING", "你在三更見到他，差了一點。"),
        ("LOSS_HEALTH_combat", "死人把你拖下去了。"),
        ("LOSS_HEALTH_health", "傷太重了。"),
    ])),
])

o["note"] = collections.OrderedDict([
    ("title", "一張摺起來的字條，留在門廳桌上"),
    ("lines", [
        "你知道自己為什麼在這裡。村子那一頭是義莊，裡面有一口棺材，等人來認等得太久了。",
        "他的神主牌在停柩房。拿了它，從天井的月門出去——那是出村的唯一一條路——再把它埋回亂葬崗。把名字還給他，他就能安息。",
        "手腳快一點。你從九點到三更，多一回合都沒有。鼓一響他就醒了，你人在哪一間，他就上哪一間。",
        "門都在牆上。用它們。",
    ]),
    ("dismiss", "把它摺起來"),
])

# ---- The narration -----------------------------------------------------------
o["lines"] = collections.OrderedDict([
    ("wake", "你在{room}醒過來。天亮以前找到{relic}{goal}。"),
    ("wake-goal", "，埋回{goal}"),
    ("wait", "你在{room}裡等著。"),
    ("reveal", "你推開門，是{room}，走了進去。"),
    ("move", "你走進{room}。"),
    ("step-out", "你踏上{room}。外面是夜氣，還有更糟的東西。"),
    ("hp-gain", "回了{n}點血。"),
    ("hp-loss", "掉了{n}點血。"),
    ("heal-tile", "你在這裡定了定神。回一點血。"),
    ("damage", "受了{n}點傷。"),
    ("untouched", "他們沒碰到你。"),
    ("spent", "{item}用掉了。"),
    ("cured", "傷口裡的灰退了。中毒解了。"),
    ("rite-take", "棺材蓋沒有釘死。屋裡有東西不答應。"),
    ("rite-bury", "你跪下來開始挖。這裡的土鬆得過分。"),
    ("rite-aborted", "你跑了。你來這裡要做的事還沒做。"),
    ("relic-found", "棺材之間，{relic}。是你的了。"),
    ("dead-end", "從這裡沒有路了——直到{dir}邊那面牆塌下來。"),
    ("breach-working", "有東西在弄{dir}邊那面牆。"),
    ("blood-escape", "你把{item}摔在地上。他們在裡面找不到你了。"),
    ("ran", "你往{dir}跑，跑進{room}。"),
    ("villager-empty-handed", "你沒有東西可以給他們。"),
    ("search-took", "你把房間翻了一遍。{item}。"),
    ("search-swap", "放下{dropped}，拿起{found}。"),
    ("search-kept", "{item}。"),
    ("search-left", "你讓{item}留在原地。"),
    ("search-no-room", "放不下{item}了。它留在原處。"),
    ("search-nowhere", "{item}，可是沒地方放。"),
    ("use-heal", "{item}。回了{n}點血。"),
    ("use-bad-half", "{item}。抽到壞的那一半：{n}點血。"),
    ("use-plain", "{item}。"),
    ("cinnabar-painted", "你把{item}磨開，再畫一次。{target}×{n}。"),
    ("third-watch", "三更。鼓聲響過，之後什麼都不響了。"),
    ("died-paying", "你寫{item}，血不夠寫完。"),
    ("strike-eleven", "十一點。最後一個時辰——牌翻完了，就是三更。"),
    ("replay-link", "重玩連結：{url}"),
    ("start-failed", "遊戲起不來——請看主控台。"),
    ("empty-handed", [
        "你把房間翻了一遍，什麼也沒有。",
        "灰塵，和一個本來就開著的抽屜。",
        "有人比你先來過了。",
        "沒有值得帶走的東西。",
        "你把手伸進黑裡，摸到的是黑。",
        "這裡只有房間本身。",
    ]),
])

# ---- The controls ------------------------------------------------------------
# Direction labels take {dirWord} rather than {dir}: 往N mixes scripts on the one
# control a player looks at most, and both forms are handed to every template.
o["ui"] = collections.OrderedDict([
    ("dir-N", "北"), ("dir-E", "東"), ("dir-S", "南"), ("dir-W", "西"),
    ("explore", "往{dirWord} — 探索"), ("explore-sub", "還沒去過"),
    ("moon-gate", "從月門走出去"), ("moon-gate-sub", "出村的路"),
    ("walk", "往{dirWord} — {room}"),
    ("stay", "留在原地"), ("stay-sub", "一樣要花六分鐘"),
    ("move-prompt", "走、留、或躲——都是六分鐘。"),
    ("search", "搜索這個房間"),
    ("next-turn", "下一回合"), ("next-turn-sub", "六分鐘"),
    ("quiet-prompt", "房裡很安靜。"),
    ("fight-with", "用{item}打"), ("fight-bare", "空手迎上去"),
    ("attack", "攻擊力 {n}"), ("attack-blood", "攻擊力 {n} · 其中{blood}是你自己的血"),
    ("escape-sub", "他們就找不到你了"),
    ("run", "往{dirWord}跑 — {room}"), ("run-sub", "這回合就在落腳的地方結束"),
    ("give", "把糯米給他"), ("refuse", "自己留著"),
    ("give-sub", "用掉一份{item}"), ("refuse-sub", "就這樣的話，{n}隻"),
    ("kit-prompt", "他就在門口。只有一擊——你拿什麼給他看？"),
    ("kit-only", "只有{item}"), ("kit-bare", "只有兩隻手"),
    ("slot-empty", "空的"), ("slot-stack", "{n}張，共用一格"),
    ("use", "使用"), ("use-item", "使用{item}"),
    ("use-blocked", "{item}——沒有符可以複製"),
    ("use-blocked-title", "沒有符可以複製"),
    ("tablet-held", "在你身上，而且不佔格子"), ("tablet-missing", "還沒找到"),
    ("attack-ceiling", "最高 {n}"), ("unharmed", "毫髮無傷"),
    ("cinnabar-title", "磨開{item}"),
    ("cinnabar-lede", "一道符畫兩次，就靈兩次。畫哪一張——你會多{n}張，而一疊還是只佔一格。"),
    ("cinnabar-choice", "{item} — 現在{have}張，之後{after}張"),
    ("cinnabar-leave", "先留著"),
    ("drop-title", "你找到{item}"),
    ("drop-lede", "手上滿了。要拿起來，就得先放下一樣。"),
    ("drop-one", "放下{item}"), ("drop-stack", "放下{item}×{n}——整疊"),
    ("drop-leave", "讓它留在原地"),
    ("ways-out", "挑一條路出去"),
    ("cost-none", "不會受傷"), ("cost-gain", "回{n}點血"),
    ("cost-loss", "會受{n}點傷"),
    ("cost-lethal", "{sentence}——這會要你的命"), ("kills-you", "這會要你的命"),
    ("badge-take", "神主牌在這裡。"), ("badge-bury", "在這裡把神主牌埋了。"),
    ("badge-heal", "在這裡歇著能回血。"),
    ("play-again", "再玩一次"), ("replay-seed", "重玩這個種子"),
    ("copy-link", "複製重玩連結"), ("menu", "回主選單"),
    ("link-copied", "連結複製好了"),
    ("calm-on", "平靜模式：開"), ("calm-off", "平靜模式：關"),
    ("sound-on", "聲音：開"), ("sound-off", "聲音：關"),
    ("fullscreen", "全螢幕"), ("leave-fullscreen", "離開全螢幕"),
    ("replay-link-fallback", "重玩連結：{url}"),
    ("start-failed", "遊戲起不來——請看主控台。"),
    # The four panel labels. Short on purpose: the panel is narrow and these sit
    # above the value rather than beside it.
    ("stat-health", "血"), ("stat-attack", "攻擊力"),
    ("stat-relic", "神主牌"),
    # The clock. Chinese counts the hour and does not say the half at all, so
    # the meridiem keys are deliberately empty rather than translated — and the
    # template drops the space with a trim.
    ("hour", "{n}點"),
    ("clock", "{time}"), ("half-pm", ""), ("half-am", ""),
])

# The cold open's two paragraphs. The four charms carry both languages at once
# by design and the title lockup is a bilingual wordmark, so neither moves.
o["landing"] = collections.OrderedDict([
    ("tagline", "夜裡九點。三更時分，他來找你。讓他入土，或是等他來的時候還站著。"),
    ("footnote", "瀏覽器上的免費單人桌遊。規則出自一套可自行列印的原作；"
                 "村子、這個夜晚，還有裡面的一切，是我們的。"),
])

o["verdict"] = collections.OrderedDict([
    ("lasted", "撐到{hour}"),
    ("put-down", "放倒了{n}隻{monsters}"),
    ("found-one", "找到1件東西"), ("found-many", "找到{n}件東西"),
    ("relic-buried", "{relic}埋回土裡了"),
    ("relic-carried", "{relic}還在你身上，沒有埋"),
    ("relic-lost", "始終沒有找到{relic}"),
    ("seed", "種子 {seed}"),
    ("won-fallback", "你撐到天亮了"), ("lost-fallback", "你成了他們的一員"),
])

# The room, read aloud. Chinese puts the direction first and the verb last, and
# each clause is whole — which is exactly why these were kept as fragments.
o["room"] = collections.OrderedDict([
    ("here", "{room}，你在這裡。"),
    ("wall", "{dir}邊，一面牆。"),
    ("wall-failing", "{dir}邊，一面牆快塌了——他們正從那裡進來。"),
    ("outside", "{dir}邊，那道箭頭門通到外面。"),
    ("open", "{dir}邊，{thing}通往{room}{cross}。"),
    ("blocked", "{dir}邊，{thing}，走不通。"),
    ("unexplored", "{dir}邊，{thing}，後面還沒去過。"),
    ("crossing", "，跨過交界"),
    ("thing-broken", "一個破洞"), ("thing-arrow", "那道箭頭門"),
    ("thing-open", "一道開著的門"), ("thing-door", "一道門"),
    ("thing-shut", "一道關著的門"), ("somewhere", "去過的地方"),
])

o["effects"] = collections.OrderedDict([
    ("join", " · "),
    ("weapon-attack", "攻擊力 {n}"), ("talisman-attack", "打{n}"),
    ("cost-hp", "寫它要{n}點血"),
    ("duplicate", "複製一張你有的符，+{n}"),
    ("double-sword", "劍的攻擊力加倍，一次"),
    ("escape", "全身而退"),
    ("heal", "回{n}點血"), ("gamble-join", " 或 "),
    ("cures-poison", "把中毒解掉"),
    ("damage-reduction", "殭屍造成的傷減{n}"),
])

o["tileNotes"] = collections.OrderedDict([
    ("start-indoor", "你從這裡開始。"),
    ("start-outdoor", "開局先抽出來——你第一次踏出去的時候它就放下。"),
    ("search-weapon", "在這裡搜索武器。"),
    ("search-magic", "在這裡搜索符咒。"),
    ("search-medicine", "在這裡搜索丹藥。"),
    ("search-relic", "在這裡搜索法器——全村只有這裡有。"),
    ("search-other", "在這裡搜索{what}。"),
    ("moon-gate", "帶著月門——它{dir}邊那條路通到村外，不是通到別的房間。"),
    ("seam", "沿著接縫和村子相連，也是回去的路。"),
    ("take-tablet", "{tablet}在這裡。先解決這間房的事件，再解決開棺的那一件。撐過去而且人還站在這裡，它就是你的。"),
    ("bury-tablet", "先破土，再解決挖掘的那一件。帶著{tablet}撐過去，你就贏了。"),
    ("heal-1", "回合在這裡結束就回1點血。"),
    ("unknown", "特殊：{what}"),
    ("doors-all", "四面牆都有門"), ("doors-some", "門在{dirs}"),
    ("doors-join", "、"), ("doors-seam", "，{dir}邊是接縫"), ("doors-end", "。"),
    # Unreachable in Chinese by definition — it is what shows when the theme
    # failed to load, and the translation lives in the theme. Kept so coverage
    # is a real 100% rather than 100% with an asterisk.
    ("load-failed", "載入不了這套牌。"),
])

o["tallyLine"] = collections.OrderedDict([
    ("left-once", "你從這棟屋子裡走出去過一次。它從來沒留住你。"),
    ("left-many", "你從這棟屋子裡走出去過{n}。它從來沒留住你。"),
    ("taken", "這棟屋子留住過你{n}。"),
    ("walked-out", "你走出去過{n}。"),
    ("times", "{n}次"), ("once", "一次"), ("twice", "兩次"),
    ("words", ["零", "一", "二", "三", "四", "五", "六", "七",
               "八", "九", "十", "十一", "十二"]),
])


# ---- The epilogue ------------------------------------------------------------
# The sentence somebody screenshots. Three clauses — how it ended, what was in
# your hand, how close you got — and that order reads the same way round in
# Chinese, which is why this is a table and not a second assembler. `join` and
# `end` carry the only real difference: full-width punctuation.
#
# buried and sealed are the two wins and are held to the same length here as in
# English, for the same §9 reason.
o["epilogue"] = collections.OrderedDict([
    ("join", "，"),
    ("end", "。"),
    ("open", collections.OrderedDict([
        ("won", "天亮的時候你走了出去"),
        ("won-hurt", "天亮的時候你走了出去，只剩最後一口氣"),
        ("combat", "他們在{hour}把你拖了下去"),
        ("combat-swarmed", "他們{hour}從牆裡進來，就沒有停過"),
        ("health", "你在{hour}流乾了血"),
        ("health-worn", "到{hour}，這個村子把你磨穿了"),
        ("midnight", "三更找到你的時候，你還在屋裡"),
        ("king", "他在三更來找你"),
    ])),
    ("hand", collections.OrderedDict([
        ("armed", "手裡握著{weapon}"),
        ("dry", "{weapon}已經用盡了"),
        ("bare", "手上什麼都沒有"),
        ("tool", "身上只有一把{weapon}"),
    ])),
    ("close", collections.OrderedDict([
        ("buried", "{relic}也回到了它該在的土裡"),
        ("sealed", "那張紙也還留在他的額頭上"),
        ("carrying-near", "{relic}在你身上，離{goal}只剩{rooms}"),
        ("carrying-there", "{relic}在你身上，{goal}就在你腳下"),
        ("carrying-far", "{relic}在你身上，{goal}還有{rooms}"),
        ("carrying-lost", "{relic}在你身上，卻沒有路通到{goal}"),
        ("never", "始終沒有找到{relic}"),
        ("never-close", "始終沒有找到{relic}，離{goal}只剩{rooms}"),
    ])),
    ("rooms", collections.OrderedDict([
        ("1", "一間房"), ("2", "兩間房"), ("3", "三間房"), ("4", "四間房"),
        ("5", "五間房"), ("6", "六間房"), ("7", "七間房"), ("8", "八間房"),
        ("9", "九間房"), ("10", "十間房"), ("11", "十一間房"), ("12", "十二間房"),
        ("many", "{n}間房"),
    ])),
    ("hours", collections.OrderedDict([
        ("21", "九點"), ("22", "十點"), ("23", "十一點"), ("24", "三更"),
    ])),
])

# ---- Coverage ----------------------------------------------------------------
def leaves(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "_note":
                continue
            yield from leaves(v, f"{path}.{k}")
    elif isinstance(node, list):
        yield path
    else:
        yield path

en_keys = set(leaves(en))
zh_keys = set(leaves(o))
missing = sorted(en_keys - zh_keys)
extra = sorted(zh_keys - en_keys)
print(f"english leaves {len(en_keys)} | zh leaves {len(zh_keys)}")
print(f"covered {len(en_keys & zh_keys)}/{len(en_keys)} = {100*len(en_keys&zh_keys)//len(en_keys)}%")
if missing:
    print("MISSING:")
    for m in missing:
        print("   ", m)
if extra:
    print("EXTRA (not in English):", extra)

# ---- The write, and why it is guarded -----------------------------------------
# This script is a one-shot batch that was never retired, and the zh file moved
# on without it: #32 equipment, #55 menu, #62 mode marks, #68 fight-spend and a
# few dozen more were written straight into data/theme.zh-TW.json and never came
# back here. The write used to be the first statement after the table, so
# running this deleted every one of those translations, and the coverage report
# printed AFTERWARDS -- describing a file it had already destroyed.
#
# Nothing chose that; it is what a batch script becomes when it outlives its
# batch. So the write compares itself against the file on disk and refuses when
# it would take a key away. Refusing is the correct outcome: this script cannot
# regenerate the current file, and saying so is more useful than clobbering it.
existing = {}
if os.path.exists(OUT):
    existing = json.load(io.open(OUT, encoding="utf-8"),
                         object_pairs_hook=collections.OrderedDict)
lost = sorted(set(leaves(existing)) - zh_keys) if existing else []
if lost:
    print()
    print(f"REFUSING TO WRITE: {len(lost)} translations already in the file are")
    print("not declared here, and writing would delete them:")
    for k in lost:
        print("   ", k)
    print()
    print("Add them here, or edit the JSON directly and leave this script alone.")
    raise SystemExit(1)

io.open(OUT, "w", encoding="utf-8", newline="\n").write(
    json.dumps(o, ensure_ascii=False, indent=2) + "\n")
print(f"wrote {OUT}")

