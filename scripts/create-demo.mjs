import { writeFile } from 'node:fs/promises';
// Independently authored, small public demonstration dataset; not a transcription of the book.
const groups = [
  ['自然地理', 'THE NATURAL WORLD', [
    ['atmosphere', 'n.', '大气；气氛', '/ˈætməsfɪə(r)/', 'A calm atmosphere helps me concentrate.', '安静的氛围有助于我集中注意力。', '搭配记忆：a relaxed atmosphere，轻松的氛围。'],
    ['hydrosphere', 'n.', '水圈', '/ˈhaɪdrəsfɪə(r)/', 'Oceans form a large part of the hydrosphere.', '海洋构成了水圈的很大一部分。', '联想记忆：把地球上的海洋、河流和湖泊想成一个整体。'],
    ['lithosphere', 'n.', '岩石圈', '/ˈlɪθəsfɪə(r)/', 'The lithosphere is the rigid outer part of the Earth.', '岩石圈是地球坚硬的外层部分。', '对比记忆：lithosphere 岩石圈；hydrosphere 水圈。'],
    ['oxygen', 'n.', '氧；氧气', '/ˈɒksɪdʒən/', 'Fish need oxygen dissolved in water.', '鱼需要溶解在水中的氧气。', '场景记忆：呼吸、潜水与氧气瓶。'],
    ['oxide', 'n.', '氧化物', '/ˈɒksaɪd/', 'The experiment produced a metal oxide.', '实验产生了一种金属氧化物。', '搭配记忆：metal oxide，金属氧化物。'],
    ['carbon dioxide', 'n.', '二氧化碳', '/ˌkɑːbən daɪˈɒksaɪd/', 'Trees absorb carbon dioxide as they grow.', '树木在生长过程中吸收二氧化碳。', '搭配记忆：carbon dioxide emissions，二氧化碳排放。'],
    ['hydrogen', 'n.', '氢；氢气', '/ˈhaɪdrədʒən/', 'Hydrogen can be used as a fuel.', '氢可以用作燃料。'],
    ['core', 'n.', '核心；地核', '/kɔː(r)/', 'Practice is at the core of this course.', '练习是这门课程的核心。'],
    ['crust', 'n.', '地壳；硬皮', '/krʌst/', 'The crust is the outermost layer of the Earth.', '地壳是地球最外面的一层。'],
    ['mantle', 'n.', '地幔；披风', '/ˈmæntl/', 'The mantle lies beneath the crust.', '地幔位于地壳之下。'],
    ['longitude', 'n.', '经度', '/ˈlɒŋɡɪtjuːd/', 'The map shows both latitude and longitude.', '地图同时标出了纬度和经度。'],
    ['latitude', 'n.', '纬度', '/ˈlætɪtjuːd/', 'Day length changes with latitude.', '白昼长度随纬度而变化。']
  ]],
  ['植物研究', 'PLANTS & GROWTH', [
    ['seed', 'n.', '种子', '/siːd/', 'We planted a seed in a small pot.', '我们在一个小花盆里种下一粒种子。'],
    ['habitat', 'n.', '栖息地', '/ˈhæbɪtæt/', 'The wetland provides a habitat for many plants.', '这片湿地为许多植物提供了生境。']
  ]],
  ['动物保护', 'ANIMALS & CONSERVATION', [
    ['wildlife', 'n.', '野生动物', '/ˈwaɪldlaɪf/', 'Noise can disturb local wildlife.', '噪声会干扰当地的野生动物。'],
    ['species', 'n.', '物种', '/ˈspiːʃiːz/', 'This island is home to several rare species.', '这座岛屿是几种珍稀物种的家园。']
  ]],
  ['太空探索', 'SPACE & DISCOVERY', [
    ['orbit', 'n.', '轨道', '/ˈɔːbɪt/', 'The satellite entered a stable orbit.', '卫星进入了一条稳定的轨道。'],
    ['planet', 'n.', '行星', '/ˈplænɪt/', 'The team is studying a distant planet.', '团队正在研究一颗遥远的行星。']
  ]],
  ['学校教育', 'LEARNING & EDUCATION', [
    ['curriculum', 'n.', '课程体系；全部课程', '/kəˈrɪkjələm/', 'The new curriculum includes practical projects.', '新的课程体系包含实践项目。'],
    ['scholarship', 'n.', '奖学金', '/ˈskɒləʃɪp/', 'She applied for a scholarship to study abroad.', '她申请了出国留学的奖学金。']
  ]],
  ['科技发明', 'SCIENCE & TECHNOLOGY', [
    ['innovation', 'n.', '创新', '/ˌɪnəˈveɪʃn/', 'Innovation often begins with a simple question.', '创新常常始于一个简单的问题。'],
    ['device', 'n.', '装置；设备', '/dɪˈvaɪs/', 'This device measures air quality.', '这个设备测量空气质量。']
  ]],
  ['文化历史', 'CULTURE & HISTORY', [
    ['heritage', 'n.', '遗产', '/ˈherɪtɪdʒ/', 'The museum protects the cultural heritage of the city.', '博物馆保护这座城市的文化遗产。'],
    ['tradition', 'n.', '传统', '/trəˈdɪʃn/', 'Sharing a meal is an important family tradition.', '一起吃饭是一项重要的家庭传统。']
  ]],
  ['语言演化', 'LANGUAGE & COMMUNICATION', [
    ['dialect', 'n.', '方言', '/ˈdaɪəlekt/', 'My grandparents speak a local dialect.', '我的祖父母说一种当地方言。'],
    ['fluent', 'adj.', '流利的', '/ˈfluːənt/', 'Regular conversation helped her become fluent.', '经常对话帮助她说得更加流利。']
  ]],
  ['娱乐运动', 'LEISURE & SPORT', [
    ['athlete', 'n.', '运动员', '/ˈæθliːt/', 'The athlete trains before breakfast.', '这位运动员在早餐前训练。'],
    ['leisure', 'n.', '闲暇', '/ˈleʒə(r)/', 'I enjoy reading in my leisure time.', '我喜欢在闲暇时阅读。']
  ]],
  ['物品材料', 'OBJECTS & MATERIALS', [
    ['fabric', 'n.', '织物；布料', '/ˈfæbrɪk/', 'This fabric dries quickly.', '这种布料干得很快。'],
    ['durable', 'adj.', '耐用的', '/ˈdjʊərəbl/', 'We need a durable material for the roof.', '我们需要一种耐用的屋顶材料。']
  ]],
  ['时尚潮流', 'FASHION & STYLE', [
    ['garment', 'n.', '服装', '/ˈɡɑːmənt/', 'Each garment is made from recycled cotton.', '每件服装都由再生棉制成。'],
    ['trend', 'n.', '趋势；潮流', '/trend/', 'The survey revealed a new consumer trend.', '调查揭示了一种新的消费趋势。']
  ]],
  ['饮食健康', 'FOOD & NUTRITION', [
    ['nutrition', 'n.', '营养', '/njuˈtrɪʃn/', 'Good nutrition supports healthy growth.', '良好的营养有助于健康成长。'],
    ['ingredient', 'n.', '原料；成分', '/ɪnˈɡriːdiənt/', 'Beans are the main ingredient in this dish.', '豆子是这道菜的主要原料。']
  ]],
  ['建筑场所', 'BUILDINGS & PLACES', [
    ['architecture', 'n.', '建筑学；建筑风格', '/ˈɑːkɪtektʃə(r)/', 'The city is known for its modern architecture.', '这座城市以现代建筑风格闻名。'],
    ['residence', 'n.', '住所', '/ˈrezɪdəns/', 'The old school became a private residence.', '这所旧学校变成了一处私人住宅。']
  ]],
  ['交通旅行', 'TRANSPORT & TRAVEL', [
    ['commute', 'v.', '通勤', '/kəˈmjuːt/', 'Many people commute by train.', '许多人乘火车通勤。'],
    ['destination', 'n.', '目的地', '/ˌdestɪˈneɪʃn/', 'We reached our destination before sunset.', '我们在日落前到达了目的地。']
  ]],
  ['国家政府', 'GOVERNMENT & POLICY', [
    ['policy', 'n.', '政策', '/ˈpɒləsi/', 'The policy aims to reduce waste.', '这项政策旨在减少浪费。'],
    ['citizen', 'n.', '公民', '/ˈsɪtɪzn/', 'Every citizen can take part in the discussion.', '每位公民都可以参与讨论。']
  ]],
  ['社会经济', 'SOCIETY & ECONOMY', [
    ['investment', 'n.', '投资', '/ɪnˈvestmənt/', 'The town needs more investment in public transport.', '这个城镇需要更多公共交通投资。'],
    ['employment', 'n.', '就业', '/ɪmˈplɔɪmənt/', 'The project created new employment opportunities.', '这个项目创造了新的就业机会。']
  ]],
  ['法律法规', 'LAW & REGULATION', [
    ['legislation', 'n.', '法律；立法', '/ˌledʒɪsˈleɪʃn/', 'The legislation protects personal information.', '这项法律保护个人信息。'],
    ['evidence', 'n.', '证据', '/ˈevɪdəns/', 'The report presents clear evidence.', '这份报告提供了清晰的证据。']
  ]],
  ['沙场争锋', 'CONFLICT & PEACE', [
    ['conflict', 'n.', '冲突', '/ˈkɒnflɪkt/', 'Open discussion can help resolve a conflict.', '公开讨论有助于解决冲突。'],
    ['defence', 'n.', '防御；辩护', '/dɪˈfens/', 'The wall was built for defence.', '这道墙是为了防御而建的。']
  ]],
  ['社会角色', 'PEOPLE & ROLES', [
    ['volunteer', 'n.', '志愿者', '/ˌvɒlənˈtɪə(r)/', 'A volunteer showed us around the library.', '一位志愿者带我们参观了图书馆。'],
    ['colleague', 'n.', '同事', '/ˈkɒliːɡ/', 'My colleague shared a useful idea.', '我的同事分享了一个有用的想法。']
  ]],
  ['行为动作', 'ACTIONS & CHANGE', [
    ['adapt', 'v.', '适应；改编', '/əˈdæpt/', 'Students need time to adapt to a new routine.', '学生需要时间适应新的日常安排。'],
    ['participate', 'v.', '参与', '/pɑːˈtɪsɪpeɪt/', 'Everyone is welcome to participate.', '欢迎每个人参与。']
  ]],
  ['身心健康', 'BODY & MIND', [
    ['anxiety', 'n.', '焦虑', '/æŋˈzaɪəti/', 'A short walk helped ease my anxiety.', '短暂的散步帮助缓解了我的焦虑。'],
    ['wellbeing', 'n.', '身心健康；幸福', '/ˌwelˈbiːɪŋ/', 'Sleep is important for our wellbeing.', '睡眠对我们的身心健康很重要。']
  ]],
  ['时间日期', 'TIME & ROUTINE', [
    ['duration', 'n.', '持续时间', '/djuˈreɪʃn/', 'The duration of the lesson is one hour.', '这节课的持续时间是一小时。'],
    ['annual', 'adj.', '每年的；年度的', '/ˈænjuəl/', 'The club holds an annual meeting.', '俱乐部每年举行一次会议。']
  ]]
];
const chapters = groups.map(([name, subtitle], index) => ({ id: String(index + 1), name, subtitle }));
const words = groups.flatMap(([, , entries], index) => entries.map(([word, pos, meaning, phonetic, example, translation, memory = '']) => ({ id: word, word, variants: word === 'defence' ? ['defence', 'defense'] : [word], pos, meanings: [meaning], chapters: [String(index + 1)], phonetic, example, translation, memory, usage: '', source: '本项目自编学习示例' })));
await writeFile(new URL('../data/demo.json', import.meta.url), JSON.stringify({ version: 1, name: '雅思主题示例词库', kind: 'demo', chapters, words }, null, 2) + '\n');
const enrichment = Object.fromEntries(words.map(({ id, phonetic, example, translation, memory }) => [id, { phonetic, example, translation, memory }]));
await writeFile(new URL('../data/enrichment.json', import.meta.url), JSON.stringify(enrichment, null, 2) + '\n');
console.log(`已生成 ${chapters.length} 章、${words.length} 条自编示例。`);
