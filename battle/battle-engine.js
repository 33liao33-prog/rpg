'use strict';
(async () => {
  if (typeof waitGlobalInitialized === 'function') {
    await waitGlobalInitialized('Mvu');
    console.log('MVU 框架已就绪');
  } else {
    console.warn('MVU 框架不可用，将使用默认等级');
  }
})();

/* ===== MVU数据读取函数 ===== */
function getMvuStatData() {
  try {
    if (typeof Mvu === 'undefined' || typeof Mvu.getMvuData !== 'function') {
      addLog('警告: MVU 框架不可用，无法读取变量', 'system');
      return null;
    }
    const variables = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
    let statData = _.get(variables, 'stat_data');
    if (typeof statData === 'string') {
      try {
        statData = JSON.parse(statData);
      } catch (e) {
        console.error('解析 stat_data 字符串失败:', e);
        return null;
      }
    }
    return statData || null;
  } catch (e) {
    console.error('读取 MVU 数据失败:', e);
    return null;
  }
}

/* ===== MVU 实体查找工具 ===== */
const MVU_ENTITY_RECORDS = ['魔法少女', '魔物', '怪人', 'BOSS', '普通人'];
const MVU_COMBAT_RECORDS = ['魔法少女', '魔物', '怪人', 'BOSS'];

function findMvuEntity(statData, name) {
  if (!statData || !name) return null;
  const protagonist = _.get(statData, '主角');
  if (protagonist && protagonist.姓名 === name) {
    return { path: '主角', entity: protagonist, type: '主角' };
  }
  for (const type of MVU_ENTITY_RECORDS) {
    const record = _.get(statData, type, {});
    if (record && record[name]) {
      return { path: `${type}.${name}`, entity: record[name], type };
    }
  }
  return null;
}

// 从某实体读出前端战斗所需的核心属性
function readMvuEntityStats(entity) {
  if (!entity) return null;
  const battleInfo = _.get(entity, '战斗信息', {});
  const attr = _.get(battleInfo, '属性值', {});
  const hpObj = _.get(attr, '体力', {});
  const mpObj = _.get(attr, '精力', {});
  const levelExp = _.get(entity, '角色信息.等级与经验', {});
  const race = _.get(entity, '$种族值', {});
  return {
    hp: { current: hpObj.当前值 ?? 9999, max: hpObj.上限 ?? 100 },
    mp: { current: mpObj.当前值 ?? 9999, max: mpObj.上限 ?? 75 },
    atk: { base: attr.$物攻 ?? 25 },
    matk: attr.$魔攻 ?? 25,
    def: attr.$防御 ?? 25,
    spd: attr.$速度 ?? 25,
    battleLevel: levelExp.当前等级 ?? 1,
    exp: levelExp.当前经验 ?? 0,
    race: {
      $体质种族值固定值: race.$体质种族值固定值 || 0,
      $智力种族值固定值: race.$智力种族值固定值 || 0,
      $防御种族值固定值: race.$防御种族值固定值 || 0,
      $敏捷种族值固定值: race.$敏捷种族值固定值 || 0,
      体质种族值加值: race.$体质种族值加值 || 0,
      智力种族值加值: race.$智力种族值加值 || 0,
      防御种族值加值: race.$防御种族值加值 || 0,
      敏捷种族值加值: race.$敏捷种族值加值 || 0,
    },
    genderRaw: _.get(entity, '角色信息.性别', '男'),
  };
}

function mapGenderToUnit(raw) {
  if (raw === '男') return 'male';
  if (raw === '女') return 'female';
  return 'TS';
}

function getAvailablePlayerNames() {
    const statData = getMvuStatData();
    if (!statData) {
        addLog('警告: 无法读取MVU变量，将使用所有可用角色', 'system');
        return null;
    }

    const availableNames = new Set();

    // 1. 主角
    const protagonist = _.get(statData, '主角');
    if (protagonist && protagonist.姓名) {
        availableNames.add(protagonist.姓名);
    }

    // 2. attitude_towards_user === '友方' && isPresent === true 的四类角色
    MVU_COMBAT_RECORDS.forEach(type => {
        const record = _.get(statData, type, {});
        Object.entries(record).forEach(([name, data]) => {
            if (data && data.attitude_towards_user === '友方' && data.isPresent === true) {
                availableNames.add(name);
            }
        });
    });

    addLog(`MVU过滤: 可出战我方角色 = [${[...availableNames].join(', ')}]`, 'system');
    return availableNames;
}

function getAvailableEnemyNames() {
    const statData = getMvuStatData();
    if (!statData) {
        addLog('警告: 无法读取MVU变量，将使用所有可用敌人', 'system');
        return null;
    }

    const availableNames = new Set();

    MVU_COMBAT_RECORDS.forEach(type => {
        const record = _.get(statData, type, {});
        Object.entries(record).forEach(([name, data]) => {
            if (data && data.attitude_towards_user === '敌对' && data.isPresent === true) {
                availableNames.add(name);
            }
        });
    });

    addLog(`MVU过滤: 敌方角色 = [${[...availableNames].join(', ')}]`, 'system');
    return availableNames;
}

function getAvailableEnemyEntries() {
    const statData = getMvuStatData();
    if (!statData) return null;

    const entries = [];
    MVU_COMBAT_RECORDS.forEach(recordKey => {
        const record = _.get(statData, recordKey, {});
        Object.entries(record).forEach(([name, data]) => {
            if (data && data.attitude_towards_user === '敌对' && data.isPresent === true) {
                entries.push({
                    name: name,                       
                    recordType: recordKey,           
                    type: data.类型 || '',            
                    entity: data,
                });
            }
        });
    });
    addLog(`MVU敌人列表: [${entries.map(e => `${e.name}(${e.type || '无类型'})`).join(', ')}]`, 'system');
    return entries;
}

const ACTION_TYPE = {
  ATTACK: 'attack',
  NON_ATTACK: 'non-attack'
};

function normalizeActionType(actionType) {
  if (actionType === 'non_attack') return ACTION_TYPE.NON_ATTACK;
  if (actionType === 'non-attack') return ACTION_TYPE.NON_ATTACK;
  if (actionType === 'attack') return ACTION_TYPE.ATTACK;
  return actionType;
}
// ===== 侵蚀技能组定义 =====
const EROSION_SKILLS = [
{
    name: '自慰',
    erosionRequired: 100,
    description: '通过自我抚慰的姿态魅惑敌人，削弱其战斗意志',
    imageUrl: 'https://raw.githubusercontent.com/33liao33-prog/pic/refs/heads/main/images/map/v.mp4',
    targetType: 'self',
    actionType: ACTION_TYPE.ATTACK,   
    hpDamage: 0,
    pleasureDamage: 0.25,            
    damageType: 'pleasure_phy',       
    attributeMultiplier: 0,
    effects: [],
    customLogs: [
        '{attacker}开始自慰，发出销魂的喘息声。',
        '{attacker}开始自慰，手指在身体上游走，脸上泛起红晕。'
    ]
},
{
    name: '手交榨精',
    erosionRequired: 100,
    description: '以手部技巧进行情欲攻击，灵活多变',
    targetType: 'single_enemy',
    actionType: ACTION_TYPE.ATTACK,
    hpDamage: 0,
    pleasureDamage: 0.1,            
    damageType: 'pleasure_agi',      
    attributeMultiplier: 0.4,
    effects: []
},
{
    name: '乳交榨精',
    erosionRequired: 150,
    description: '用丰满的胸部夹住性器摩擦，造成大量情欲伤害',
    targetType: 'single_enemy',
    actionType: ACTION_TYPE.ATTACK,
    hpDamage: 0,
    pleasureDamage: 0.2,
    damageType: 'pleasure_phy',      
    attributeMultiplier: 0.6,
    effects: [
      { type: 'pleasure_up', value: 0.15, duration: 2 }
    ]
},
{
    name: '素股榨精',
    erosionRequired: 150,
    description: '用大腿根部摩擦对方性器，让敌人陷入情欲漩涡',
    targetType: 'single_enemy',
    actionType: ACTION_TYPE.ATTACK,
    hpDamage: 0,
    pleasureDamage: 0.15,
    damageType: 'pleasure_agi',
    attributeMultiplier: 0.5,
    effects: []
},
{
    name: '发交',
    erosionRequired: 150,
    description: '用秀发缠绕敌人的性器，发丝的触感让敌人难以抗拒',
    targetType: 'single_enemy',
    actionType: ACTION_TYPE.ATTACK,
    hpDamage: 0,
    pleasureDamage: 0.1,
    damageType: 'pleasure_agi',
    attributeMultiplier: 0.45,
    effects: []
},
{
    name: '腋窝交',
    erosionRequired: 150,
    description: '用腋下的特殊触感攻击敌人，罕见的方式让敌人无法防备',
    targetType: 'single_enemy',
    actionType: ACTION_TYPE.ATTACK,
    hpDamage: 0,
    pleasureDamage: 0.15,
    damageType: 'pleasure_phy',
    attributeMultiplier: 0.5,
    effects: []
},
{
    name: '足交榨精',
    erosionRequired: 150,
    description: '用灵巧的双足挑逗性器，足尖的触感让敌人神魂颠倒',
    targetType: 'single_enemy',
    actionType: ACTION_TYPE.ATTACK,
    hpDamage: 0,
    pleasureDamage: 0.2,
    damageType: 'pleasure_agi',
    attributeMultiplier: 0.55,
    effects: []
},
{
    name: '膣交榨精',
    erosionRequired: 200,
    description: '用阴道性交榨取异性的精液，造成巨额情欲伤害',
    targetType: 'single_enemy',
    actionType: ACTION_TYPE.ATTACK,
    hpDamage: 0,
    pleasureDamage: 0.3,
    damageType: 'pleasure_phy',
    attributeMultiplier: 0.8,
    effects: [
      { type: 'pleasure_up', value: 0.25, duration: 3 }
    ]
},
{
    name: '肛交榨精',
    erosionRequired: 200,
    description: '用紧致的肛门性交榨取精液，压迫感让敌人疯狂',
    targetType: 'single_enemy',
    actionType: ACTION_TYPE.ATTACK,
    hpDamage: 0,
    pleasureDamage: 0.25,
    damageType: 'pleasure_phy',
    attributeMultiplier: 0.7,
    effects: [
      { type: 'custom_debuff', name: '失神', description: '智力降低15%', remainingActions: 2, effects: [
        { stat: 'intelligence', value: -0.15, duration: 2 }
      ] }
    ]
},
{
    name: '口交榨精',
    erosionRequired: 200,
    description: '用口舌进行灵活的榨精，致命的吸吮让敌人防线崩溃',
    targetType: 'single_enemy',
    actionType: ACTION_TYPE.ATTACK,
    hpDamage: 0,
    pleasureDamage: 0.25,
    damageType: 'pleasure_phy',
    attributeMultiplier: 0.65,
    effects: [
      { type: 'pleasure_up', value: 0.20, duration: 2 }
    ]
}
];

function getUnitErosionValue(unit) {
  try {
    const statData = getMvuStatData();
    if (!statData) return 0;
    const found = findMvuEntity(statData, unit.name);
    if (found && found.entity) {
      return _.get(found.entity, 'feel.erosion', 0) || 0;
    }
    return 0;
  } catch (e) {
    console.error('getUnitErosionValue 出错:', e);
    return 0;
  }
}

function getErosionSkillsForUnit(unit) {
  const gender = String(unit.gender || '').toLowerCase();
  if (gender === 'male' || gender === '男' || gender === 'm') return [];
const erosionValue = getUnitErosionValue(unit);
  return EROSION_SKILLS.map(skill => ({
    ...skill,
    unlocked: erosionValue >= skill.erosionRequired,
    currentErosion: erosionValue
  }));
}

function buildErosionSkillObject(skillData) {
  return normalizeSkillEffects({
    name: skillData.name,
    targetType: skillData.targetType || 'single_enemy',
    actionType: skillData.actionType || ACTION_TYPE.ATTACK,
    cost: { hp: 0, mp: 0 },
    hpDamage: skillData.hpDamage || 0,
    pleasureDamage: skillData.pleasureDamage || 0,
    damageType: skillData.damageType || 'pleasure_phy',
    attributeMultiplier: skillData.attributeMultiplier || 0,
    effects: skillData.effects ? skillData.effects.map(effect => ({ ...effect })) : [],
    description: skillData.description,
    requiredLevel: 0,
    isErosionSkill: true,
    erosionRequired: skillData.erosionRequired,
    imageUrl: skillData.imageUrl,
    customLogs: skillData.customLogs || []
  });
}

let worldbookData = {
  players: null,
  enemies: null,
  statusEffects: null,
  skills: null
};

async function loadFromWorldbook() {
  try {
    if (typeof getWorldbook !== 'function') {
      addLog('错误: 无法连接到SillyTavern API，请确保在SillyTavern环境中运行', 'system');
      return false;
    }
    addLog('正在从世界书加载数据...', 'system');
    const result = await getWorldbook('RPG战斗数据');
    
    let entries = [];
    if (Array.isArray(result)) {
      entries = result;
    } else if (result && typeof result === 'object') {
      if (result.entries) {
        entries = Object.values(result.entries);
      } else {
        entries = Object.values(result);
      }
    }
    
    if (!entries || entries.length === 0) {
      addLog('错误: 未找到"petdata"世界书条目', 'system');
      return false;
    }
    addLog(`找到 ${entries.length} 个世界书条目`, 'system');
    
    const findEntry = (name) => {
      for (const entry of entries) {
        if (entry.comment === name) return entry;
        if (Array.isArray(entry.key) && entry.key.includes(name)) return entry;
        if (typeof entry.key === 'string' && entry.key === name) return entry;
        if (entry.name === name) return entry;
      }
      return null;
    };
    
    const parseContent = (entry) => {
      if (!entry || !entry.content) return null;
      try {
        return JSON.parse(entry.content);
      } catch (e) {
        addLog(`解析失败: ${entry.comment || '未知'}`, 'system');
        return null;
      }
    };
    
    const playersEntry = findEntry('玩家角色模板');
    const enemiesEntry = findEntry('敌人模板');
    const statusEntry = findEntry('状态效果定义');
    const skillsEntry = findEntry('技能模板');
    
    worldbookData.players = playersEntry ? parseContent(playersEntry) : null;
    worldbookData.enemies = enemiesEntry ? parseContent(enemiesEntry) : null;
    worldbookData.statusEffects = statusEntry ? parseContent(statusEntry) : null;
    worldbookData.skills = skillsEntry ? parseContent(skillsEntry) : null;
    
    if (worldbookData.players) addLog(`成功加载: 玩家角色模板 (${worldbookData.players.length}个)`, 'system');
    else addLog('加载失败: 玩家角色模板', 'system');
    if (worldbookData.enemies) addLog(`成功加载: 敌人模板 (${worldbookData.enemies.length}个)`, 'system');
    else addLog('加载失败: 敌人模板', 'system');
    if (worldbookData.statusEffects) addLog('成功加载: 状态效果定义', 'system');
    else addLog('加载失败: 状态效果定义', 'system');
    if (worldbookData.skills) addLog(`成功加载: 技能模板 (${worldbookData.skills.length}个)`, 'system');
    else addLog('加载失败: 技能模板', 'system');
    
    if (!worldbookData.players || worldbookData.players.length === 0) {
      addLog('错误: 未找到"玩家角色模板"数据', 'system');
      return false;
    }
    if (!worldbookData.enemies || worldbookData.enemies.length === 0) {
      addLog('错误: 未找到"敌人模板"数据', 'system');
      return false;
    }
    
    addLog('所有数据加载成功！', 'system');
    return true;
  } catch (error) {
    addLog(`加载世界书数据失败: ${error.message}`, 'system');
    return false;
  }
}

async function loadPlayerState() {
    try {
        if (typeof getVariables !== 'function') return null;
        const variables = await getVariables({ type: 'chat' });
        if (!variables || !variables['角色数据']) return null;
        const playerData = variables['角色数据'];
        
        if (playerData.units && Array.isArray(playerData.units) && playerData.units.length > 0) {
            // 从 MVU 读取核心属性并覆盖
            const mvuStatData = getMvuStatData();
            let units = playerData.units;

            units = units.map(unit => {
                // 根据名字查找 MVU 中对应的角色数据
                const mvuFound = findMvuEntity(mvuStatData, unit.name);
                if (mvuFound && mvuFound.entity) {
                    const parsed = readMvuEntityStats(mvuFound.entity);
                    if (parsed) {
                        unit.hp = parsed.hp;
                        unit.mp = parsed.mp;
                        unit.atk = parsed.atk;
                        unit.matk = parsed.matk;
                        unit.def = parsed.def;
                        unit.spd = parsed.spd;
                        unit.battleLevel = parsed.battleLevel;
                        unit.exp = parsed.exp;
                        if (!unit.种族值) unit.种族值 = {};
                        unit.种族值.体质种族值加值 = parsed.race.体质种族值加值;
                        unit.种族值.智力种族值加值 = parsed.race.智力种族值加值;
                        unit.种族值.防御种族值加值 = parsed.race.防御种族值加值;
                        unit.种族值.敏捷种族值加值 = parsed.race.敏捷种族值加值;
                        unit.种族值.$体质种族值固定值 = parsed.race.$体质种族值固定值;
                        unit.种族值.$智力种族值固定值 = parsed.race.$智力种族值固定值;
                        unit.种族值.$防御种族值固定值 = parsed.race.$防御种族值固定值;
                        unit.种族值.$敏捷种族值固定值 = parsed.race.$敏捷种族值固定值;
                    }
                }
                // 确保其他字段存在
                if (unit.ac === undefined) unit.ac = [];
                if (unit.buffs === undefined) unit.buffs = [];
                if (unit.debuffs === undefined) unit.debuffs = [];
                if (unit.pleasure === undefined) unit.pleasure = { current: 0, max: 100, damageBonus: 0 };
                if (unit.stats === undefined) unit.stats = { constitution: 5, intelligence: 5, agility: 5 };
                if (unit.learnedSkills === undefined) unit.learnedSkills = [];
                if (unit.equippedSkills === undefined) unit.equippedSkills = [];
                if (unit.skillCooldowns === undefined) unit.skillCooldowns = {};
                return unit;
            });

            // 处理 userData（类似）
            if (playerData.userData) {
                const userInUnits = units.find(u => u.name === playerData.userData.name);
                if (!userInUnits) {
                    // 从 MVU 读取主角数据作为 userData 的核心属性
                    const mvuStatData2 = getMvuStatData();
                    const protagonist2 = _.get(mvuStatData2, '主角');
                    if (protagonist2) {
                        const parsed = readMvuEntityStats(protagonist2);
                        if (parsed) {
                            playerData.userData.hp = parsed.hp;
                            playerData.userData.mp = parsed.mp;
                            playerData.userData.atk = parsed.atk;
                            playerData.userData.matk = parsed.matk;
                            playerData.userData.def = parsed.def;
                            playerData.userData.spd = parsed.spd;
                            playerData.userData.battleLevel = parsed.battleLevel;
                            playerData.userData.exp = parsed.exp;
                            if (!playerData.userData.种族值) playerData.userData.种族值 = {};
                            playerData.userData.种族值.体质种族值加值 = parsed.race.体质种族值加值;
                            playerData.userData.种族值.智力种族值加值 = parsed.race.智力种族值加值;
                            playerData.userData.种族值.防御种族值加值 = parsed.race.防御种族值加值;
                            playerData.userData.种族值.敏捷种族值加值 = parsed.race.敏捷种族值加值;
                            playerData.userData.种族值.$体质种族值固定值 = parsed.race.$体质种族值固定值;   
                            playerData.userData.种族值.$智力种族值固定值 = parsed.race.$智力种族值固定值;   
                            playerData.userData.种族值.$防御种族值固定值 = parsed.race.$防御种族值固定值;   
                            playerData.userData.种族值.$敏捷种族值固定值 = parsed.race.$敏捷种族值固定值;   
                        }
                    } 
                    units.push(playerData.userData);
                } else {
                    Object.assign(userInUnits, playerData.userData, {
                        hp: playerData.userData.hp,
                        mp: playerData.userData.mp,
                        atk: playerData.userData.atk,
                        matk: playerData.userData.matk,
                        def: playerData.userData.def,
                        spd: playerData.userData.spd,
                        battleLevel: playerData.userData.battleLevel,
                        exp: playerData.userData.exp,
                        种族值: playerData.userData.种族值
                    });
                }
            }

            addLog(`从保存数据加载了 ${units.length} 个玩家角色（核心属性从MVU读取，其他从聊天变量读取）`, 'system');
            return units;
        }
        return null;
    } catch (error) {
        console.error('加载玩家状态失败:', error);
        addLog(`加载玩家状态失败: ${error.message}`, 'system');
        return null;
    }
}

async function saveToMvu() {
    try {
        const variables = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
        let stat_data = _.get(variables, 'stat_data');
        if (!stat_data) {
            addLog('错误: 无法获取MVU数据，保存失败', 'system');
            return false;
        }

        const writeEntity = (unit) => {
            const found = findMvuEntity(stat_data, unit.name);
            if (!found) return;
            const path = found.path;

            _.set(stat_data, `${path}.战斗信息.属性值.体力.当前值`, unit.hp.current);
            _.set(stat_data, `${path}.战斗信息.属性值.体力.上限`, unit.hp.max);
            _.set(stat_data, `${path}.战斗信息.属性值.精力.当前值`, unit.mp.current);
            _.set(stat_data, `${path}.战斗信息.属性值.精力.上限`, unit.mp.max);

            _.set(stat_data, `${path}.战斗信息.属性值.$物攻`, unit.atk?.base || 0);
            _.set(stat_data, `${path}.战斗信息.属性值.$魔攻`, unit.matk || 0);
            _.set(stat_data, `${path}.战斗信息.属性值.$防御`, unit.def || 0);
            _.set(stat_data, `${path}.战斗信息.属性值.$速度`, unit.spd || 0);

            _.set(stat_data, `${path}.角色信息.等级与经验.当前等级`, unit.battleLevel);
            _.set(stat_data, `${path}.角色信息.等级与经验.当前经验`, unit.exp || 0);

            if (unit.种族值) {
                _.set(stat_data, `${path}.$种族值.$体质种族值加值`, unit.种族值.体质种族值加值 || 0);
                _.set(stat_data, `${path}.$种族值.$智力种族值加值`, unit.种族值.智力种族值加值 || 0);
                _.set(stat_data, `${path}.$种族值.$防御种族值加值`, unit.种族值.防御种族值加值 || 0);
                _.set(stat_data, `${path}.$种族值.$敏捷种族值加值`, unit.种族值.敏捷种族值加值 || 0);
            }
        };

        G.playerUnits.forEach(writeEntity);
        G.enemyUnits.forEach(writeEntity);

        await Mvu.replaceMvuData({ stat_data }, { type: 'message', message_id: getCurrentMessageId() });
        addLog('战斗数据已保存到MVU', 'system');
        return true;
    } catch (error) {
        console.error('保存到MVU失败:', error);
        addLog(`保存到MVU失败: ${error.message}`, 'system');
        return false;
    }
}

async function savePlayerState() {
    try {
        await saveToMvu();  
        if (typeof insertOrAssignVariables !== 'function') {
            addLog('savePlayerState: insertOrAssignVariables 不可用', 'system');
            return false;
        }

        const battleUnitsData = G.playerUnits.map(unit => ({
            id: unit.id,
            name: unit.name,
            gender: unit.gender,
            portraitUrl: unit.portraitUrl,
            ac: unit.ac ? unit.ac.map(ac => ({ source: ac.source, current: ac.current, max: ac.max, remainingTurns: ac.remainingTurns })) : [],
            buffs: unit.buffs || [],
            debuffs: unit.debuffs || [],
            isStunned: unit.isStunned || false,
            isTaunting: unit.isTaunting || false,
            stats: unit.stats,
            freeAttributePoints: unit.freeAttributePoints, 
            skills: unit.skills ? unit.skills.map(s => typeof s === 'string' ? s : s.name) : [],
            learnedSkills: unit.learnedSkills ? unit.learnedSkills.map(s => typeof s === 'string' ? s : s.name) : [],
            equippedSkills: unit.equippedSkills ? unit.equippedSkills.map(s => typeof s === 'string' ? s : s.name) : [],
            pleasure: { current: unit.pleasure.current, max: unit.pleasure.max, damageBonus: unit.pleasure.damageBonus },
            clothingIntegrity: unit.clothingIntegrity,
            consciousnessSystem: unit.consciousnessSystem,
            pregnancySystem: unit.pregnancySystem,
        }));

        let userData = null;
        const userInBattle = G.playerUnits.find(unit => unit.name === '<user>' || unit.name === 'user');
        if (userInBattle) {
            userData = battleUnitsData.find(u => u.name === userInBattle.name);
        } else if (window.loadedPlayers) {
            const originalUser = window.loadedPlayers.find(p => p.name === '<user>' || p.name === 'user');
            if (originalUser) {
                userData = {
                    id: originalUser.id,
                    name: originalUser.name,
                    gender: originalUser.gender,
                    portraitUrl: originalUser.portraitUrl,
                    ac: originalUser.ac || [],
                    buffs: originalUser.buffs || [],
                    debuffs: originalUser.debuffs || [],
                    isStunned: false,
                    isTaunting: false,
                    stats: originalUser.stats,
                    freeAttributePoints: originalUser.freeAttributePoints || 0,
                    skills: originalUser.skills ? originalUser.skills.map(s => typeof s === 'string' ? s : s.name) : [],
                    learnedSkills: originalUser.learnedSkills ? originalUser.learnedSkills.map(s => typeof s === 'string' ? s : s.name) : [],
                    equippedSkills: originalUser.equippedSkills ? originalUser.equippedSkills.map(s => typeof s === 'string' ? s : s.name) : [],
                    pleasure: { current: originalUser.pleasure.current, max: originalUser.pleasure.max, damageBonus: originalUser.pleasure.damageBonus },
                    clothingIntegrity: originalUser.clothingIntegrity !== undefined ? originalUser.clothingIntegrity : 100,
                    consciousnessSystem: originalUser.consciousnessSystem,
                    pregnancySystem: originalUser.pregnancySystem
                };
            }
        }

        const playerData = {
            units: battleUnitsData,
            userData: userData,
            lastBattleTurn: G.turn,
            lastBattleResult: G.phase === 'over' ? (G.playerUnits.some(u => u.hp.current > 0) ? 'win' : 'lose') : 'ongoing',
            lastSaveTime: new Date().toISOString()
        };

        await insertOrAssignVariables({ '角色数据': playerData }, { type: 'chat' });
        addLog('其他战斗数据已保存到聊天变量', 'system');
        return true;
    } catch (error) {
        console.error('保存玩家状态失败:', error);
        addLog(`保存玩家状态失败: ${error.message}`, 'system');
        return false;
    }
}

function showErrorMessage() {
  const grid = document.getElementById('selection-grid');
  if (grid) {
    grid.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:40px; background:#fff0f0; border:2px solid #c9445a; border-radius:8px;">
        <h3 style="color:#c9445a;">数据加载失败</h3>
        <p style="margin:20px 0;">无法从世界书读取战斗数据</p>
        <button class="gem-button" onclick="location.reload()" style="margin-top:20px;">重试</button>
      </div>
    `;
  }
  const startBtn = document.getElementById('btn-start-battle');
  if (startBtn) startBtn.disabled = true;
}

async function loadGameData() {
    let players = null;
    let enemies = null;
    const worldbookLoaded = await loadFromWorldbook();
    if (worldbookLoaded) {
        if (worldbookData.players) addLog(`从世界书加载了${worldbookData.players.length}个玩家角色模板`, 'system');
        if (worldbookData.enemies) {
            enemies = worldbookData.enemies;
            addLog(`从世界书加载了${enemies.length}个敌人模板`, 'system');
        }
    }
    // ★ 工具 1：把 MVU 实体作为战斗单位加入 list
    //   优先用 chat 存档（playerState）中的同名角色；没有才用世界书模板作为初始值
    const pushMvuEntityAsUnit = (list, name, entity, chatUnits = [], opts = {}) => {
        if (!entity) return;
        const existing = list.find(p => p.name === name);
        if (existing) return;

        const parsed = readMvuEntityStats(entity) || {};

        // ---- 1. 找一个"非 MVU 数据"的来源：chat 存档 > 世界书模板 ----
        let source = null;
        let sourceTag = '';

        // 1a. 优先 chat 存档
        const chatUnit = (chatUnits || []).find(u => u.name === name);
        if (chatUnit) {
            source = chatUnit;
            sourceTag = 'chat存档';
        } else if (worldbookData.players) {
            // 1b. 其次世界书模板
            const tpl = worldbookData.players.find(t => t.name === name);
            if (tpl) {
                source = tpl;
                sourceTag = '世界书模板';
            }
        }

        // ---- 2. 解析技能：字符串 → 技能对象 ----
        const resolveSkillList = (arr) => (arr || []).map(s => {
            if (typeof s === 'string') return getSkillFromWorldbook(s) || { name: s, requiredLevel: 0 };
            if (s && typeof s === 'object' && s.name && !s.type) {
                // 存档里存的是 { name: "xxx" } 这种精简对象，用世界书补全
                const full = getSkillFromWorldbook(s.name);
                return full || s;
            }
            return s;
        });

        // 从 source 里取技能（若 source 为空则全空数组）
        const rawSkills        = source?.skills        || [];
        const rawLearned       = source?.learnedSkills || rawSkills;
        const rawEquipped      = source?.equippedSkills|| [];
        const skillsResolved        = resolveSkillList(rawSkills);
        const learnedResolved       = resolveSkillList(rawLearned);
        const equippedResolved      = resolveSkillList(rawEquipped);

        // ---- 3. 其它"前端专有数据"也从 source 继承，没有就用默认值 ----
        const unit = {
            id: source?.id || `mvu_${Date.now()}_${name}`,
            name,

            // === 核心属性：永远以 MVU 为准 ===
            gender: mapGenderToUnit(parsed.genderRaw),
            battleLevel: parsed.battleLevel || 1,
            exp: parsed.exp || 0,
            hp: parsed.hp || { current: 9999, max: 100 },
            mp: parsed.mp || { current: 9999, max: 75 },
            atk: parsed.atk || { base: 25 },
            matk: parsed.matk || 25,
            def: parsed.def || 25,
            spd: parsed.spd || 25,
            种族值: {
                $体质种族值固定值: parsed.race?.$体质种族值固定值 || 0,
                $智力种族值固定值: parsed.race?.$智力种族值固定值 || 0,
                $防御种族值固定值: parsed.race?.$防御种族值固定值 || 0,
                $敏捷种族值固定值: parsed.race?.$敏捷种族值固定值 || 0,
                体质种族值加值: parsed.race?.体质种族值加值 || 0,
                智力种族值加值: parsed.race?.智力种族值加值 || 0,
                防御种族值加值: parsed.race?.防御种族值加值 || 0,
                敏捷种族值加值: parsed.race?.敏捷种族值加值 || 0,
            },

            // === 非 MVU 数据：从 source（chat > 模板）继承，没 source 就用默认 ===
            skills:          skillsResolved,
            learnedSkills:   learnedResolved,
            equippedSkills:  equippedResolved,
            portraitUrl:     source?.portraitUrl || null,
            clothingIntegrity: source?.clothingIntegrity ?? 100,
            consciousnessSystem: source?.consciousnessSystem ?? null,
            pregnancySystem: source?.pregnancySystem ?? null,
            pleasure: source?.pleasure || { current: 0, max: 100, damageBonus: 0 },
            ac:      source?.ac || [],
            buffs:   source?.buffs || [],
            debuffs: source?.debuffs || [],
            isStunned: source?.isStunned || false,
            isTaunting: source?.isTaunting || false,
            stats: source?.stats || { constitution: 5, intelligence: 5, agility: 5 },
            freeAttributePoints: source?.freeAttributePoints || 0,

            ...opts,
        };

        list.push(unit);

        if (source) {
            addLog(`从MVU补充 ${opts.tag || ''} ${name} 到玩家列表（非核心数据来自${sourceTag}）`, 'system');
        } else {
            addLog(`从MVU补充 ${opts.tag || ''} ${name} 到玩家列表（无初始技能/头像来源）`, 'system');
        }
    };
    const fillPlayersFromMvu = (list, mvuStatData, chatUnits = []) => {
        if (!mvuStatData) return;
        const protagonist = _.get(mvuStatData, '主角');
        if (protagonist && protagonist.姓名) {
            pushMvuEntityAsUnit(list, protagonist.姓名, protagonist, chatUnits, { tag: '主角' });
        }
        MVU_COMBAT_RECORDS.forEach(type => {
            const record = _.get(mvuStatData, type, {});
            Object.entries(record).forEach(([name, entity]) => {
                if (entity && entity.attitude_towards_user === '友方' && entity.isPresent === true) {
                    pushMvuEntityAsUnit(list, name, entity, chatUnits, { tag: type });
                }
            });
        });
    };

    const playerState = await loadPlayerState();
    if (playerState && playerState.length > 0) {
        players = playerState;
        if (worldbookData.players) {
            players = players.map(savedUnit => {
                if (!savedUnit.portraitUrl) {
                    const template = worldbookData.players.find(t => t.id === savedUnit.id || t.name === savedUnit.name);
                    if (template && template.portraitUrl) savedUnit.portraitUrl = template.portraitUrl;
                }
                return savedUnit;
            });
        }
        const mvuStatData = getMvuStatData();
        fillPlayersFromMvu(players, mvuStatData, playerState);

        addLog(`从保存数据加载了${players.length}个玩家角色（含当前状态）`, 'system');
    } else {
        if (worldbookData.players && worldbookData.players.length > 0) {
            players = worldbookData.players;
            addLog(`从世界书加载了${players.length}个玩家角色模板（无保存数据）`, 'system');
        } else {
            players = [];
        }

        const mvuStatData = getMvuStatData();
        fillPlayersFromMvu(players, mvuStatData, []);
    }

    if (!players || players.length === 0) {
        addLog('错误: 没有可用的玩家角色数据', 'system');
        showErrorMessage();
        return { players: [], enemies: [] };
    }
    if (!enemies || enemies.length === 0) {
        addLog('错误: 没有可用的敌人数据', 'system');
        showErrorMessage();
        return { players: players, enemies: [] };
    }
    return { players, enemies };
}


function getSkillFromLibrary(skillLibrary, skillName) {
  if (!skillLibrary) return null;
  
  if (skillLibrary[skillName]) {
    return skillLibrary[skillName];
  }
  
  if (Array.isArray(skillLibrary)) {
    return skillLibrary.find(s => s && s.name === skillName);
  }
  
  return null;
}

function resolveSkills(units, skillLibrary) {
  if (!units || !skillLibrary) return units;
  
  return units.map(unit => {
    const processedUnit = clone(unit);
    
    const normalizeSkill = (skill) => {
      let skillObj = null;
      if (typeof skill === 'string') {
        skillObj = getSkillFromLibrary(skillLibrary, skill);
      } else if (skill && typeof skill === 'object') {
        skillObj = clone(skill);
      }
      if (skillObj) {
        return normalizeSkillEffects(skillObj);
      }
      return null;
    };
    
    if (processedUnit.skills) {
      processedUnit.skills = processedUnit.skills.map(normalizeSkill).filter(s => s);
    }
    if (processedUnit.learnedSkills) {
      processedUnit.learnedSkills = processedUnit.learnedSkills.map(normalizeSkill).filter(s => s);
    }
    if (processedUnit.equippedSkills) {
      processedUnit.equippedSkills = processedUnit.equippedSkills.map(normalizeSkill).filter(s => s);
    }
    return processedUnit;
  });
}

// ===== 禁止重复添加的状态列表 =====
const NO_DUPLICATE_DEBUFFS = [
  '高潮寸止',
  '发情',
  '怀孕',
  '寄生',
  '孕育',
  '淫纹',
  '拘束',
  '肉铠拘束',
  '肉铠护甲',
  '眩晕',
  '麻痹',
  '膨乳（小）',
  '膨乳（中）',
  '膨乳（大）',
  '强制泌乳',
  '混乱',
  '魅惑',
  '产卵',
  '高潮恍惚'  
];

const FORMULA_TYPES = {
    LINEAR: "linear",
    BY_MAX_HP: "by_max_hp",
    BY_MAX_MP: "by_max_mp",
    BY_MAX_PLEASURE: "by_max_pleasure",
    BY_AC: "by_ac",
    STAT_PERCENT: "stat_percent",
    ARMOR_PEN: "armor_pen",
    THRESHOLD: "threshold"
};

function getMergeStrategy(effectType) {
    const ADD_STRATEGY = ['bleed', 'burn', 'pleasure_dot', 'heal', 'mp_restore', 'shield', 'accuracy', 'evasion'];
    const MAX_STRATEGY = ['constitution', 'intelligence', 'agility', 'def', 'counter', 'heal_percent', 'repair_clothing'];
    const REPLACE_STRATEGY = ['taunt', 'stun', 'confusion', 'charm', 'restraint', 'purify'];
    
    if (ADD_STRATEGY.includes(effectType)) return 'add';
    if (MAX_STRATEGY.includes(effectType)) return 'max';
    if (REPLACE_STRATEGY.includes(effectType)) return 'replace';
    return 'add';
}

function isStackableStatus(statusName, config = {}) {
    for (const pattern of NO_DUPLICATE_DEBUFFS) {
        if (typeof pattern === 'string') {
            if (statusName === pattern) return false;
        } else if (pattern instanceof RegExp) {
            if (pattern.test(statusName)) return false;
        }
    }
    if (config.stackable === false) return false;
    return true;
}

let G = {
  phase: 'init',
  turn: 0,
  playerUnits: [],
  enemyUnits: [],
  fusionUnits: [],
  selectedUnit: null,
  selectedSkill: null,
  log: [],
  actionQueue: [],
  processedUnits: new Set(),
  currentActingUnit: null,
  enemySpecialSkillsEnabled: true,
  expDistributed: false,
  maleParasiteEnabled: true,    
  malePregnancyEnabled: true,     
  maleHypnosisEnabled: true,
  targetSelectionMode: false,   
  pendingSkill: null,            
  pendingAttacker: null,
  globalCooldowns: {},
  _isAOE: false,
  logFilters: {
    system: true,    
    damage: true,    
    heal: true,      
    pleasure: true,  
    orgasm: true     
  }
};

let preBattlePlayerData = null;
let pendingLearnedSkills = [];

function getBaseActionCost(unit) {
    const spd = (unit.spd || 0) + 100;
    return Math.max(1, Math.floor(10000 / spd));
}

function calculateActionCost(unit, skill = null) {
  const baseCost = getBaseActionCost(unit);
  let modifier = (skill && skill.actionCostModifier !== undefined) ? skill.actionCostModifier : 1.0;
  modifier = Math.max(0.1, modifier);
  return Math.max(1, Math.floor(baseCost * modifier));
}

function getUnitSnapshot(unit) {
  return {
    id: unit.id,
    name: unit.name,
    remainingAP: unit.remainingAP || 0,
    agility: getFinalStat(unit, 'agility'),
    isStunned: unit.isStunned || false,
    isDead: unit.hp.current <= 0,
    baseCost: getBaseActionCost(unit)   
  };
}

function simulateFutureActions(rounds = 16, overrideInfo = null) {
  let snapshots = [...G.playerUnits, ...G.enemyUnits]
    .map(u => getUnitSnapshot(u))
    .filter(s => !s.isDead);
  
  if (overrideInfo && overrideInfo.unit && overrideInfo.skill) {
    const snapshot = snapshots.find(s => s.id === overrideInfo.unit.id);
    if (snapshot && !snapshot.isDead && !snapshot.isStunned) {
      const realCost = calculateActionCost(overrideInfo.unit, overrideInfo.skill);
      snapshot.remainingAP -= realCost;
      
      if (overrideInfo.skill.effects) {
        let agilityMod = 1.0;
        for (const effect of overrideInfo.skill.effects) {
          if (effect.type === 'agi_up_small') agilityMod *= (1 + 0.10);
          else if (effect.type === 'agi_up_medium') agilityMod *= (1 + 0.30);
          else if (effect.type === 'agi_up_large') agilityMod *= (1 + 0.50);
          else if (effect.type === 'agi_up_extreme') agilityMod *= (1 + 1.00);
          else if (effect.stat === 'agility') agilityMod *= (1 + (effect.value || 0));
        }
        if (agilityMod !== 1.0) {
          snapshot.agility = Math.max(1, Math.floor(snapshot.agility * agilityMod));
          snapshot.baseCost = Math.max(1, Math.floor(10000 / snapshot.agility));
        }
      }
    }
  }
  
  const results = [];
  let currentTurnOffset = 0;
  let actionCount = 0;
  
  while (actionCount < rounds && snapshots.length > 0) {
    const active = snapshots.filter(s => 
      !s.isDead && !s.isStunned && s.remainingAP >= s.baseCost
    );
    
    if (active.length === 0) {
      snapshots.forEach(s => { s.remainingAP += 100; });
      currentTurnOffset++;
      continue;
    }
    
    active.sort((a, b) => {
      if (a.remainingAP !== b.remainingAP) return b.remainingAP - a.remainingAP;
      return b.agility - a.agility;
    });
    
    const actor = active[0];
    const cost = actor.baseCost;
    
    results.push({
      unitName: actor.name,
      unitId: actor.id,
      turn: G.turn + currentTurnOffset,
      apBefore: actor.remainingAP,
      apAfter: actor.remainingAP - cost
    });
    
    actor.remainingAP -= cost;
    actionCount++;
  }
  
  return results;
}

function getFinalStat(unit, statName) {
    const base = unit.stats ? (unit.stats[statName] || 5) : 5;
    let totalBonus = 0;
    
    const allStatuses = [...(unit.buffs || []), ...(unit.debuffs || [])];
    for (const status of allStatuses) {
        if (status.effects) {
            for (const effect of status.effects) {
                if (effect.stat === statName) {
                    let bonusValue = 0;
                    if (status.stackable && effect.currentValue !== undefined) {
                        // 可叠加状态：使用已计算的 currentValue
                        bonusValue = effect.currentValue;
                    } else if (effect.value !== undefined) {
                        // 普通状态：直接使用 value
                        bonusValue = effect.value;
                    } else {
                        continue;
                    }
                    totalBonus += bonusValue;
                }
            }
        }
    }
    
    // 对敏捷取最大增益（原有逻辑保留）
    if (statName === 'agility') {
        let maxBonus = 0;
        allStatuses.forEach(status => {
            if (status.effects) {
                status.effects.forEach(effect => {
                    if (effect.stat === 'agility') {
                        let bonus = status.stackable ? (effect.currentValue || 0) : (effect.value || 0);
                        if (bonus > maxBonus) maxBonus = bonus;
                    }
                });
            }
        });
        totalBonus = maxBonus;
    }
    
    return Math.floor(base * (1 + totalBonus));
}

function calculateMaxHP(unit) {
    return unit.hp && unit.hp.max ? unit.hp.max : 100;
}

function calculateBaseATK(unit) {
    return getUnitStat(unit, 'atk');
}

function calculateMaxMP(unit) {
    return unit.mp && unit.mp.max ? unit.mp.max : 50;
}

function getUnitStat(unit, statName) {
    let base = 0;
    switch(statName) {
        case 'atk': base = unit.atk?.base || 0; break;
        case 'matk': base = unit.matk || 0; break;
        case 'def': base = unit.def || 0; break;
        case 'spd': base = unit.spd || 0; break;
        case 'maxHp': base = unit.hp?.max || 0; break;
        case 'maxMp': base = unit.mp?.max || 0; break;
        default: return 0;
    }

    let totalBonus = 0;
    const allStatuses = [...(unit.buffs || []), ...(unit.debuffs || [])];
    for (const status of allStatuses) {
        if (!status.effects) continue;
        for (const effect of status.effects) {
            if (effect.stat !== statName) continue;
            let raw = 0;
            if (status.stackable && effect.currentValue !== undefined) {
                raw = effect.currentValue;
            } else if (effect.value !== undefined) {
                raw = effect.value;
            } else {
                continue;
            }
            const absVal = Math.abs(raw);
            const isPercent = absVal > 0 && absVal <= 1;
            if (isPercent) {
                totalBonus += base * raw;   
            } else {
                totalBonus += raw;          
            }
        }
    }

    if (statName === 'spd') {
        let maxBonus = 0;
        for (const status of allStatuses) {
            if (!status.effects) continue;
            for (const effect of status.effects) {
                if (effect.stat !== 'spd') continue;
                let raw = 0;
                if (status.stackable && effect.currentValue !== undefined) {
                    raw = effect.currentValue;
                } else if (effect.value !== undefined) {
                    raw = effect.value;
                } else {
                    continue;
                }
                const absVal = Math.abs(raw);
                const isPercent = absVal > 0 && absVal <= 1;
                let actualBonus = isPercent ? base * raw : raw;
                if (actualBonus > maxBonus) maxBonus = actualBonus;
            }
        }
        totalBonus = maxBonus;
    }
    return Math.max(0, Math.floor(base + totalBonus));
}

function updateHPMPOnStatChange(unit) {
  const oldMaxHP = unit.hp.max;
  const oldMaxMP = unit.mp.max;
  const newMaxHP = calculateMaxHP(unit);
  const newMaxMP = calculateMaxMP(unit);
  if (oldMaxHP > 0) {
    if (unit.hp.current <= 0) {
      unit.hp.current = 0; 
    } else {
      unit.hp.current = Math.max(1, Math.floor(unit.hp.current * (newMaxHP / oldMaxHP)));
    }
  }
  if (oldMaxMP > 0) unit.mp.current = Math.max(0, Math.floor(unit.mp.current * (newMaxMP / oldMaxMP)));
  unit.hp.max = newMaxHP;
  unit.mp.max = newMaxMP;
}

const clone = obj => {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
};

function findStatus(unit, statusName) {
    const statuses = [...(unit.buffs || []), ...(unit.debuffs || [])];
    return statuses.find(s => s.name === statusName);
}

function normalizeSkillEffects(skill) {
  if (!skill || !skill.effects || !Array.isArray(skill.effects)) return skill;
  
  for (let i = 0; i < skill.effects.length; i++) {
    let eff = skill.effects[i];
    
    if (typeof eff === 'string') {
      const statusName = eff;
      const def = getStatusDefinition(statusName);
      if (!def) {
        console.warn(`未找到状态定义: ${statusName}，该效果将被忽略`);
        skill.effects.splice(i, 1);
        i--;
        continue;
      }
      skill.effects[i] = {
        type: 'custom_debuff',
        name: statusName,
        displayName: def.displayName || statusName,
        description: def.description || '',
        duration: def.duration ?? 3,
        stackable: def.stackable === true,
        layers: def.layers ?? 1,
        maxLayers: def.maxLayers ?? 10,
        effects: def.effects ? clone(def.effects) : [],
        thresholdEffects: def.thresholdEffects ? clone(def.thresholdEffects) : [],
        onAttackEffects: def.onAttackEffects ? clone(def.onAttackEffects) : [],
        customLogs: def.customLogs || def.actionLogs || [],
        decayOnAttack: def.decayOnAttack === true,
        consumeOnAttack: def.consumeOnAttack === true,
        ...(def.extra && { extra: clone(def.extra) })
      };
    }
    else if (eff && eff.type === 'custom_debuff' && typeof eff.name === 'string') {
      const def = getStatusDefinition(eff.name);
      if (def) {
        if (!eff.displayName && def.displayName) eff.displayName = def.displayName;
        if (!eff.description && def.description) eff.description = def.description;
        if (eff.duration === undefined) eff.duration = def.duration ?? 3;
        if (eff.stackable === undefined) eff.stackable = def.stackable === true;
        if (eff.layers === undefined && def.layers) eff.layers = def.layers;
        if (eff.maxLayers === undefined && def.maxLayers) eff.maxLayers = def.maxLayers;
        if ((!eff.effects || eff.effects.length === 0) && def.effects) eff.effects = clone(def.effects);
        if ((!eff.thresholdEffects || eff.thresholdEffects.length === 0) && def.thresholdEffects) eff.thresholdEffects = clone(def.thresholdEffects);
        if ((!eff.onAttackEffects || eff.onAttackEffects.length === 0) && def.onAttackEffects) eff.onAttackEffects = clone(def.onAttackEffects);
        if ((!eff.customLogs || eff.customLogs.length === 0) && def.customLogs) eff.customLogs = clone(def.customLogs);
        if (eff.decayOnAttack === undefined) eff.decayOnAttack = def.decayOnAttack === true;
        if (eff.consumeOnAttack === undefined) eff.consumeOnAttack = def.consumeOnAttack === true;
      }
    }
  }
  return skill;
}

function createNewStackableStatus(statusName, config, source) {
    const layersToAdd = config.layers || 1;
    const duration = config.duration || 3;
    const maxLayers = config.maxLayers || 10;
    
    const layerDetails = [];
    for (let i = 0; i < layersToAdd; i++) {
        layerDetails.push({
            remainingTurns: duration,
            addedAtTurn: G.turn,
            sourceName: source?.name || '未知'
        });
    }
    
    return {
        name: statusName,
        displayName: config.displayName || statusName,
        description: config.description || '',
        type: config.type || 'debuff',
        stackable: true,
        totalLayers: layersToAdd,
        maxLayers: maxLayers,
        layerDetails: layerDetails,
        effects: (config.effects || []).map(e => ({ ...e })),
        thresholdEffects: (config.thresholdEffects || []).map(t => ({ ...t, triggered: false })),
        sources: [{ sourceName: source?.name || '未知', layers: layersToAdd }],
        customLogs: config.customLogs || [],
        decayOnAttack: config.decayOnAttack || false,
        onAttackEffects: config.onAttackEffects || [],   
        consumeOnAttack: config.consumeOnAttack || false
    };
}

function calculateSkillEffects(attacker, defender, skill) {
    let hpChange = 0;
    let pleasureChange = 0;

    // ---- 基础 HP 伤害/治疗 ----
    if (skill.hpDamage !== undefined && skill.hpDamage !== 0) {
        const absHp = Math.abs(skill.hpDamage);
        let baseHp = 0;
        if (absHp > 1) baseHp = absHp;
        else if (absHp > 0 && absHp <= 1) baseHp = defender.hp.max * absHp;
        hpChange = skill.hpDamage > 0 ? baseHp : -baseHp;
    }

    // ---- 基础情欲伤害 ----
    if (skill.pleasureDamage !== undefined && skill.pleasureDamage !== 0) {
        const absPleasure = Math.abs(skill.pleasureDamage);
        let basePleasure = 0;
        if (absPleasure > 1) basePleasure = absPleasure;
        else if (absPleasure > 0 && absPleasure <= 1) basePleasure = defender.pleasure.max * absPleasure;
        pleasureChange = skill.pleasureDamage > 0 ? basePleasure : -basePleasure;
    }

    // ---- 多属性加成（支持 1~3 个属性） ----
    let attrBonus = 0;
    const isPleasureType = skill.damageType && skill.damageType.startsWith('pleasure_');

    // 方式1：使用 attributeMultipliers 对象（推荐）
    if (skill.attributeMultipliers && typeof skill.attributeMultipliers === 'object') {
        for (const [attr, multiplier] of Object.entries(skill.attributeMultipliers)) {
            if (multiplier === 0) continue;
            let attrValue = 0;
            // 映射新属性名
            switch(attr) {
                case 'atk': attrValue = getUnitStat(attacker, 'atk'); break;
                case 'matk': attrValue = getUnitStat(attacker, 'matk'); break;
                case 'spd': attrValue = getUnitStat(attacker, 'spd'); break;
                case 'def': attrValue = getUnitStat(attacker, 'def'); break;
                case 'maxHp': attrValue = getUnitStat(attacker, 'maxHp'); break;
                case 'maxMp': attrValue = getUnitStat(attacker, 'maxMp'); break;
                // 兼容旧名（如 constitution → atk）
                case 'constitution': attrValue = getUnitStat(attacker, 'atk'); break;
                case 'intelligence': attrValue = getUnitStat(attacker, 'matk'); break;
                case 'agility': attrValue = getUnitStat(attacker, 'spd'); break;
                default: attrValue = 0;
            }
            attrBonus += attrValue * multiplier;
        }
    }
    // 方式2：使用 attributeMultiplier（单一属性，保留兼容）
    else if (skill.attributeMultiplier && skill.attributeMultiplier !== 0) {
        let attrValue = 0;
        const dmgType = skill.damageType || 'physical';
        // 根据伤害类型映射默认属性
        if (dmgType === 'physical' || dmgType === 'pleasure_phy') {
            attrValue = getUnitStat(attacker, 'atk');
        } else if (dmgType === 'magical' || dmgType === 'pleasure_mag') {
            attrValue = getUnitStat(attacker, 'matk');
        } else if (dmgType === 'agile' || dmgType === 'pleasure_agi') {
            attrValue = getUnitStat(attacker, 'spd');
        } else {
            attrValue = getUnitStat(attacker, 'atk');
        }
        attrBonus = attrValue * skill.attributeMultiplier;
    }

    // 将属性加成分配到 HP 或情欲伤害
    if (isPleasureType) {
        pleasureChange += attrBonus;
    } else {
        hpChange += attrBonus;
    }

    // 四舍五入
    hpChange = Math.round(hpChange);
    pleasureChange = Math.round(pleasureChange);

    // ---- 能量伤害加成（保留原逻辑） ----
    if (skill.energyDamageBonus) {
        const bonusConfig = skill.energyDamageBonus;
        const typeName = bonusConfig.typeName;
        const minEnergy = bonusConfig.min || 0;
        const energy = attacker.specialEnergy?.[typeName]?.current || 0;
        if (energy >= minEnergy) {
            const multiplier = bonusConfig.multiplier || 0.5;
            const bonusDamage = Math.floor(energy * multiplier);
            if (bonusConfig.damageType === 'pleasure') {
                pleasureChange += bonusDamage;
            } else {
                hpChange += bonusDamage;
            }
            if (bonusConfig.consumeAmount) {
                const consume = Math.min(bonusConfig.consumeAmount, energy);
                if (attacker.specialEnergy && attacker.specialEnergy[typeName]) {
                    attacker.specialEnergy[typeName].current -= consume;
                }
            }
        }
    }

    return { hpChange, pleasureChange };
}

function addLayersToStatus(status, layersToAdd, duration, source) {
    let added = 0;
    const spaceLeft = status.maxLayers - status.totalLayers;
    const actualAdd = Math.min(layersToAdd, spaceLeft);
    
    for (let i = 0; i < actualAdd; i++) {
        status.layerDetails.push({
            remainingTurns: duration,
            addedAtTurn: G.turn,
            sourceName: source?.name || '未知'
        });
        added++;
    }
    
    status.totalLayers += added;
    
    const existingSource = status.sources.find(s => s.sourceName === (source?.name || '未知'));
    if (existingSource) {
        existingSource.layers += added;
    } else {
        status.sources.push({ sourceName: source?.name || '未知', layers: added });
    }
    
    return layersToAdd - actualAdd; 
}

function recalculateStatusEffects(status) {
    const layers = status.totalLayers;
    
    status.effects.forEach(effect => {
        const { baseValue = 0, incrementPerLayer = 0, formula = 'linear', 
                basePercent = 0, incrementPercent = 0, threshold = 0 } = effect;
        
        switch (formula) {
            case 'linear':
                effect.currentValue = baseValue + layers * incrementPerLayer;
                break;
            case 'stat_percent':
                effect.currentValue = (basePercent + layers * incrementPercent) / 100;
                break;
            case 'threshold':
                effect.currentValue = layers >= threshold ? 1 : 0;
                break;
            default:
                effect.currentValue = baseValue + layers * incrementPerLayer;
        }
        
        if ((effect.type === 'burn' || effect.type === 'bleed') && formula === 'stat_percent') {
            effect.currentPercent = (basePercent + layers * incrementPercent);
            if (effect.percentSource) {
                effect.percentSourceDynamic = effect.percentSource;
            }
        }
        
        if (effect.currentValue === undefined) effect.currentValue = 0;
    });
}

function checkAndTriggerThresholdEffects(target, status, source = null) {
    if (!status.thresholdEffects) return;
    
    const effectiveSource = source || target;
    
    status.thresholdEffects.forEach(thresholdEffect => {
        const { threshold, once, triggered, effects, customLogs } = thresholdEffect;
        
        if (status.totalLayers >= threshold) {
            if (once && triggered) return;
            
            const markedEffects = effects.map(effect => ({
                ...effect,
                _fromThreshold: true
            }));
            
            markedEffects.forEach(effect => {
                applyEffect(target, effect, target);
            });
            
            if (once) thresholdEffect.triggered = true;
            
            if (customLogs && customLogs.length > 0) {
                const logText = getRandomFromArray(customLogs);
                if (logText) {
                    const formatted = formatBattleText(logText, { target: target, source: effectiveSource, unit: target });
                    if (!target._delayedThresholdLogs) target._delayedThresholdLogs = [];
                    target._delayedThresholdLogs.push(formatted);
                }
            } else {
                let effectDesc = '';
                effects.forEach(eff => {
                    if (eff.type === 'confusion') effectDesc = '陷入混乱状态';
                    else if (eff.type === 'stun') effectDesc = '陷入眩晕';
                    else if (eff.type === 'remove_self_layers') effectDesc = `清除所有${status.displayName}层数`;
                    else if (eff.type === 'deal_damage') effectDesc = `受到${eff.value}点伤害`;
                    else effectDesc = effectDesc || '触发额外效果';
                });
                const defaultLog = `${target.name}的${status.displayName || status.name}已达${threshold}层，触发效果，${effectDesc}！`;
                if (!target._delayedThresholdLogs) target._delayedThresholdLogs = [];
                target._delayedThresholdLogs.push(defaultLog);
            }
        }
    });
}

function addStackableStatus(target, statusName, config, source = null, skipLayerLog = false) {
    if (!isStackableStatus(statusName, config)) {
        return addLegacyStatus(target, statusName, config, source);
    }
    
    let existingStatus = findStatus(target, statusName);
    const statusAlreadyExists = !!existingStatus;
    const layersToAdd = config.layers || 1;
    const maxLayers = config.maxLayers || 10;
    const duration = config.duration || 3;
    
    if (!existingStatus) {
        existingStatus = createNewStackableStatus(statusName, config, source);
        const targetArray = config.type === 'buff' ? target.buffs : target.debuffs;
        if (!targetArray) {
            if (config.type === 'buff') target.buffs = [];
            else target.debuffs = [];
        }
        (config.type === 'buff' ? target.buffs : target.debuffs).push(existingStatus);
    } else {
        const overflow = addLayersToStatus(existingStatus, layersToAdd, duration, source);
        if (overflow > 0 && config.onOverflow) {
            applyEffect(target, config.onOverflow, source);
        }
        if (existingStatus.totalLayers >= existingStatus.maxLayers && config.onReachMaxLayers) {
            const maxEffects = config.onReachMaxLayers;
            maxEffects.forEach(effect => {
                applyEffect(target, effect, { name: statusName, side: target.side });
            });
            addLog(`${target.name}的${statusName}达到最大层数${existingStatus.maxLayers}，触发特殊效果！`, 'system');
            if (config.clearOnMaxLayers) {
                removeStackableLayers(target, statusName, 'all');
            }
        }
    }
    
    if (statusAlreadyExists) {
        const effectKey = effect => effect.type || effect.stat || effect.name;
        const newEffects = config.effects || [];
        newEffects.forEach(newEffect => {
            const key = effectKey(newEffect);
            const existingEffect = existingStatus.effects.find(e => effectKey(e) === key);
            if (!existingEffect) {
                existingStatus.effects.push({ ...newEffect });
            }
        });
    }
    
    recalculateStatusEffects(existingStatus);
    checkAndTriggerThresholdEffects(target, existingStatus, source);
    
    let finalStatus = findStatus(target, statusName);
    let statusExists = finalStatus && finalStatus.totalLayers > 0;
    
    if (!config._fromThreshold && !skipLayerLog && statusAlreadyExists && statusExists) {
        addLog(`${target.name}的${statusName}层数增加了${layersToAdd}，当前${finalStatus.totalLayers}/${maxLayers}`, 'system');
    }
    
    if (!config._fromThreshold && config.customLogs && config.customLogs.length > 0 && statusExists) {
        const logText = getRandomFromArray(config.customLogs);
        if (logText) {
            const formatted = formatBattleText(logText, { target: target, source: source, unit: target });
            if (window._currentSkillInProgress) {
                if (!target._pendingStatusLogs) target._pendingStatusLogs = [];
                target._pendingStatusLogs.push(formatted);
            } else {
                addLog(formatted, 'system');
            }
        }
    }
    
    return existingStatus;
}

function addLegacyStatus(target, statusName, config, source) {
    const targetArray = config.type === 'buff' ? target.buffs : target.debuffs;
    if (!targetArray) return null;
    
    const existingIndex = targetArray.findIndex(s => s.name === statusName);
    const duration = config.duration || 3;
    
    if (existingIndex !== -1) {
        if (config.refreshDuration !== false) {
            targetArray[existingIndex].duration = Math.max(targetArray[existingIndex].duration || 0, duration);
            if (targetArray[existingIndex].effects) {
                targetArray[existingIndex].effects.forEach(effect => {
                    if (effect.duration !== undefined) effect.duration = targetArray[existingIndex].duration;
                });
            }
        }
        return targetArray[existingIndex];
    }
    
    const newStatus = {
        name: statusName,
        displayName: config.displayName || statusName,
        description: config.description || '',
        duration: duration,
        type: config.type || 'debuff',
        stackable: false,
        effects: (config.effects || []).map(e => ({ ...e })),
        customLogs: config.customLogs || [],
        decayOnAttack: config.decayOnAttack || false,
        onAttackEffects: config.onAttackEffects || [],
        consumeOnAttack: config.consumeOnAttack || false
    };
    
    targetArray.push(newStatus);
  if (config.customLogs && config.customLogs.length > 0) {
    const logText = getRandomFromArray(config.customLogs);
    if (logText) {
      const formatted = formatBattleText(logText, { target: target, source: source, unit: target });
      if (window._currentSkillInProgress) {
        if (!target._pendingStatusLogs) target._pendingStatusLogs = [];
        target._pendingStatusLogs.push(formatted);
      } else {
        addLog(formatted, 'system');
      }
    }
  }
    return newStatus;
}

function removeStackableLayers(target, statusName, layersToRemove = 1, removeOldest = true) {
    const status = findStatus(target, statusName);
    if (!status || !status.stackable) return 0;
    
    let removed = 0;
    
    if (removeOldest) {
        while (removed < layersToRemove && status.layerDetails.length > 0) {
            status.layerDetails.shift();
            removed++;
        }
    } else {
        while (removed < layersToRemove && status.layerDetails.length > 0) {
            status.layerDetails.pop();
            removed++;
        }
    }
    
    status.totalLayers -= removed;
    
    if (status.totalLayers <= 0) {
        const targetArray = status.type === 'buff' ? target.buffs : target.debuffs;
        const idx = targetArray.findIndex(s => s.name === statusName);
        if (idx !== -1) targetArray.splice(idx, 1);
    } else {
        recalculateStatusEffects(status);
        addLog(`${target.name}的${statusName}层数减少了${removed}，剩余${status.totalLayers}层`, 'system');
    }
    
    return removed;
}

function processStackableStatusTurnEnd(status, unit) {
    if (!status.stackable) return true;
    if (status.decayOnAttack === true) return true;
    
    const remainingLayers = [];
    
    for (const layer of status.layerDetails) {
        if (layer.remainingTurns === -1) {
            remainingLayers.push(layer);
            continue;
        }
        
        layer.remainingTurns--;
        if (layer.remainingTurns > 0) {
            remainingLayers.push(layer);
        }
    }
    
    const removedCount = status.layerDetails.length - remainingLayers.length;
    
    if (removedCount > 0) {
        status.layerDetails = remainingLayers;
        status.totalLayers = remainingLayers.length;
        recalculateStatusEffects(status);
        addLog(`${unit.name}的${status.displayName || status.name}层数减少了${removedCount}，剩余${status.totalLayers}层`, 'system');
    }
    
    if (status.totalLayers > 0) {
    checkAndTriggerThresholdEffects(unit, status, unit);
}
    
    return status.totalLayers > 0;
}

function applyDamage(target, damage, ignoreArmor, isDot = false) {
    // ---- 1. 无敌/护盾处理 ----
    if (!isDot) {
        const turnInvincible = target.buffs.find(b => b.name === '无敌' && b.invincibleMode === 'turn');
        if (turnInvincible && turnInvincible.duration > 0) {
            addLog(`${target.name} 的无敌状态抵消了 ${damage} 点伤害！`, 'system');
            showFloat(target, '无敌', 'buff');
            return 0;
        }
        const countInvincible = findStatus(target, '无敌');
        if (countInvincible && countInvincible.stackable && countInvincible.totalLayers > 0) {
            addLog(`${target.name} 消耗了1层无敌护盾，抵消了 ${damage} 点伤害！`, 'system');
            showFloat(target, '无敌', 'buff');
            removeStackableLayers(target, '无敌', 1, true);
            return 0;
        }
    }

    let remainingDamage = damage;

    // ---- 2. 护甲（AC）吸收 ----
    if (!ignoreArmor && target.ac && target.ac.length > 0) {
        const sortedAC = [...target.ac].sort((a, b) => (a.addTime || 0) - (b.addTime || 0));
        for (let i = sortedAC.length - 1; i >= 0; i--) {
            const ac = sortedAC[i];
            if (remainingDamage <= 0) break;
            if (ac.source === '肉铠护甲' && ac.bindTargetId) {
                const boundEnemy = [...G.playerUnits, ...G.enemyUnits].find(u => u.id === ac.bindTargetId);
                if (boundEnemy && boundEnemy.hp.current > 0) {
                    const conductDamage = Math.min(remainingDamage, ac.current);
                    if (conductDamage > 0) {
                        const actualConduct = applyDamage(boundEnemy, conductDamage, true, isDot);
                        addLog(`铠甲护甲承受伤害，传导至${boundEnemy.name}，造成${actualConduct}点伤害！`, 'damage');
                        showFloat(boundEnemy, `-${actualConduct}`, 'damage');
                        checkDeath(boundEnemy);
                    }
                }
            }
            const absorbed = Math.min(remainingDamage, ac.current);
            ac.current -= absorbed;
            remainingDamage -= absorbed;
            if (ac.current <= 0) {
                const idx = target.ac.indexOf(ac);
                if (idx > -1) target.ac.splice(idx, 1);
                addLog(`${ac.source}被破坏`, 'system');
                if (ac.source === '肉铠护甲' && ac.bindTargetId) {
                    const boundEnemy = [...G.playerUnits, ...G.enemyUnits].find(u => u.id === ac.bindTargetId);
                    if (boundEnemy) {
                        const armorRestraintIdx = boundEnemy.debuffs.findIndex(d => d.name === '肉铠拘束');
                        if (armorRestraintIdx !== -1) {
                            boundEnemy.debuffs.splice(armorRestraintIdx, 1);
                            addLog(`${boundEnemy.name}的拘束解除了！`, 'system');
                        }
                    }
                }
            }
        }
    }

    // ---- 3. 防御减伤计算 ----
    if (!ignoreArmor && remainingDamage > 0 && target.def !== undefined && target.def > 0) {
        let attackerLevel = 1;
        if (G.currentActingUnit && G.currentActingUnit.battleLevel) {
            attackerLevel = G.currentActingUnit.battleLevel;
        } else {
            attackerLevel = 1;
        }
        const K = 35 + (attackerLevel * 2);
        const defValue = target.def || 0;
        const reducedDamage = Math.floor(remainingDamage * K / (defValue + K));
        if (reducedDamage < remainingDamage) {
            addLog(`${target.name} 的防御减伤了 ${remainingDamage - reducedDamage} 点伤害`, 'system');
            showFloat(target, `防御-${remainingDamage - reducedDamage}`, 'system');
        }
        remainingDamage = reducedDamage;
    }

    if (remainingDamage > 0) {
        if (target.clothingIntegrity !== undefined && target.clothingIntegrity > 0) {
            const damagePercent = remainingDamage / target.hp.max;
            const integrityLoss = Math.floor(damagePercent / 0.005);
            target.clothingIntegrity = Math.max(0, target.clothingIntegrity - integrityLoss);
        }
        target.hp.current = Math.max(0, target.hp.current - remainingDamage);
        return remainingDamage;
    }
    return damage; 
}

function addPleasure(target, amount, sourceName = null, skillName = null, skipLog = false) {
  const oldPleasure = target.pleasure.current;
  
  // ========== 检查高潮恍惚状态 ==========
  const hasOrgasmStun = target.debuffs.some(d => d.name === '高潮恍惚');
  if (hasOrgasmStun) {
    target.pleasure.current = Math.min(target.pleasure.max, target.pleasure.current + amount);
    if (!skipLog) {
      addLog(`${target.name}的情欲值增加了${amount}点（${oldPleasure} → ${target.pleasure.current}/${target.pleasure.max}）`, 'pleasure');
    }
    updateArousalStatus(target);
    return false;  
  }
  
  // ========== 寸止状态检查 ==========
  const isChastity = hasStatus(target, '高潮寸止');
  const chastityThreshold = target.pleasure.max * 0.99;
  
  if (isChastity) {
    const spaceToThreshold = Math.max(0, chastityThreshold - target.pleasure.current);
    
    if (amount <= spaceToThreshold) {
      target.pleasure.current += amount;
      if (!skipLog) {
        addLog(`${target.name}的情欲值增加了${amount}点（${oldPleasure} → ${target.pleasure.current}/${target.pleasure.max}）`, 'pleasure');
      }
    } else {
      const actualIncrease = spaceToThreshold;
      const overflow = amount - actualIncrease;
      
      target.pleasure.current += actualIncrease;
      target._chastityAccumulated = (target._chastityAccumulated || 0) + overflow;
      
      if (!skipLog) {
        if (actualIncrease > 0) {
          addLog(`${target.name}的情欲值增加到${target.pleasure.current}/${target.pleasure.max}，超出部分累计${target._chastityAccumulated}`, 'pleasure');
        } else {
          addLog(`${target.name}被添加寸止状态（累计${target._chastityAccumulated}）`, 'pleasure');
        }
      }
    }
    
    updateArousalStatus(target);
    return false;
  }
  
  // ========== 正常情欲增加 ==========
  const newPleasure = target.pleasure.current + amount;
  
  if (newPleasure < target.pleasure.max) {
    target.pleasure.current = newPleasure;
    if (!skipLog && newPleasure < target.pleasure.max) {
  addLog(`${target.name} 情欲值 +${amount} (${target.pleasure.current}/${target.pleasure.max})`, 'pleasure');
}
    updateArousalStatus(target);
    return false;  
  } else {
    const exceeded = newPleasure - target.pleasure.max;
    
    target.pleasure.current = target.pleasure.max;  
    
    if (!skipLog) {
      addLog(`${target.name}的情欲值达到了${target.pleasure.max}！`, 'pleasure');
    }
    
    target._pendingOrgasm = {
      damage: Math.floor(target.hp.max * 0.25),
      exceededAmount: exceeded,
      actualAmount: amount,
      sourceName: sourceName,
      skillName: skillName
    };
    
    updateArousalStatus(target);
    return true;  
  }
}

let orgasmCountThisTurn = 0;

function processPendingOrgasm(target, sourceName = null, skillName = null) {
  if (!target._pendingOrgasm) return false;
  
  const pending = target._pendingOrgasm;
  const orgasmText = target.gender === 'male' ? '射精' : '高潮';

  // ========== 连续高潮检测 ==========
  const continuousOrgasmTexts = [
    `刚刚${orgasmText}完的${target.name}再次${orgasmText}，身体已经不堪重负！`,
    `${target.name}连续${orgasmText}，意识开始模糊，身体不断抽搐。`,
    `快感一波接一波，${target.name}在连续${orgasmText}中几乎失去意识。`,
    `${target.name}还没来得及喘息，又一次被推上${orgasmText}的顶点！`
  ];
  
  if (orgasmCountThisTurn >= 1) {
    const text = continuousOrgasmTexts[Math.min(orgasmCountThisTurn - 1, continuousOrgasmTexts.length - 1)];
    addLog(text, 'orgasm');
  } else {
    addLog(`${target.name}的情欲值达到100%，${orgasmText}了！`, 'orgasm');
  }
  orgasmCountThisTurn++;
  
  // 造成高潮伤害
  const beforeClothing = target.clothingIntegrity !== undefined ? target.clothingIntegrity : 100;
  const actualDamage = applyDamage(target, pending.damage, false);
  
  if (actualDamage > 0) {
    addLog(`${target.name}因${orgasmText}减少了${actualDamage}点体力！`, 'damage');
    showFloat(target, `-${actualDamage}`, 'damage');
    
    const afterClothing = target.clothingIntegrity !== undefined ? target.clothingIntegrity : 100;
    const isFemale = target.gender !== 'male';
    if (beforeClothing > 0 && afterClothing === 0 && isFemale) {
      addLog(`${target.name}的服装在${orgasmText}时被完全破坏了！`, 'system');
    }
  }
  
  removeArousalStatus(target);
  
  const existingStun = target.debuffs.find(d => d.name === '高潮恍惚');
  
  if (!existingStun) {
    target.isStunned = true;
target.debuffs.push(createStatusEffect('高潮恍惚', {
    description: '无法行动，意识涣散，情欲伤害降低',
    duration: 2,  
    type: 'debuff',
    effects: [
        { stat: 'stun', value: 1, duration: 2 },
        { stat: 'pleasure_damage_taken', value: -0.5, duration: 2 }
    ]
}, { source: target }));
    addLog(`${target.name}陷入高潮恍惚状态，2回合内无法行动`, 'system');
  } else {
    addLog(`${target.name}在高潮恍惚状态下再次${orgasmText}！`, 'orgasm');
  }
  
  const chastityAccumulated = target._chastityAccumulated || 0;
  if (chastityAccumulated > 0) {
    addLog(`${target.name}累积被压制的${chastityAccumulated}点情欲一次性爆发！`, 'pleasure');
    
    const finalAmount = chastityAccumulated;
    target._chastityAccumulated = 0;
    
    const hadChastity = removeChastityStatus(target);
    
    target.pleasure.current += finalAmount;
    
    if (target.pleasure.current >= target.pleasure.max) {
      addLog(`${target.name}因情欲爆发再次${orgasmText}！`, 'orgasm');
      const extraDamage = Math.floor(target.hp.max * 0.125);
      const actualExtraDamage = applyDamage(target, extraDamage, false);
      addLog(`${target.name}因多次${orgasmText}减少了${actualExtraDamage}点体力！`, 'damage');
      showFloat(target, `-${actualExtraDamage}`, 'damage');
      target.pleasure.current = 0;
    } else {
      addLog(`${target.name}的情欲值定格在${target.pleasure.current}/${target.pleasure.max}`, 'pleasure');
    }
    
    if (hadChastity) {
      addChastityStatus(target);
    }
  } else {
    target.pleasure.current = 0;
  }
  
  const oldBonus = target.pleasure.damageBonus || 1.0;
  const newBonus = oldBonus * 0.5;
  target.pleasure.damageBonus = Math.max(0.1, newBonus);
  
  showFloat(target, orgasmText, 'pleasure');
  
  const died = checkDeath(target);
  
  delete target._pendingOrgasm;
  
  return died;
}

function removeChastityStatus(target) {
  const chastityIndex = target.debuffs.findIndex(d => d.name === '高潮寸止');
  if (chastityIndex !== -1) {
    target.debuffs.splice(chastityIndex, 1);
    return true;
  }
  return false;
}

function addChastityStatus(target) {
  if (!hasStatus(target, '高潮寸止')) {
    target.debuffs.push(createStatusEffect('高潮寸止', {
      description: '情欲被压制在99%，无法达到高潮，累积的情欲会在状态结束时爆发',
      type: 'debuff',
      duration: -1,  
      effects: []
    }, { source: target }));
  }
}

function checkDeath(unit) {
  if (unit.hp.current <= 0) {
    addLog(`${unit.name}被击败了！`, 'damage');
    if (unit.isRestrained) {
      removeRestraint(unit);
    }
    if (unit.isFused && unit.fusionComponents) {
      unit.fusionComponents.forEach(original => {
        original.hp.current = 0;
        addLog(`${original.name} 因合体解除被击败`, 'damage');
      });
      const idx = G.playerUnits.findIndex(u => u.id === unit.id);
      if (idx !== -1) G.playerUnits.splice(idx, 1);
      const fidx = G.fusionUnits.findIndex(f => f.id === unit.id);
      if (fidx !== -1) G.fusionUnits.splice(fidx, 1);
    }
    return true;
  }
  return false;
}

function checkBattleEnd() {
  if (G.phase === 'over') return true;
  
  const allPlayersDead = G.playerUnits.every(u => u.hp.current <= 0);
  const allEnemiesDead = G.enemyUnits.every(u => u.hp.current <= 0);
  
  if (allPlayersDead) { 
    if (G.phase !== 'over') {
      endGame(false); 
    }
    return true; 
  }
  if (allEnemiesDead) { 
    if (G.phase !== 'over') {
      endGame(true);   
    }
    return true; 
  }
  return false;
}

function expToNextLevel(level) {
  if (level >= 100) return Infinity;
  return Math.floor(level * 160);
}

function getEnemyExp(enemy) {
  const enemyLevel = enemy.battleLevel || 1;
  let bountyMultiplier = 1.0;
  if (enemy.isBoss) bountyMultiplier = 4.0;
  else if (enemy.isSummoned) bountyMultiplier = 0.5;
  return Math.floor(enemyLevel * 40 * bountyMultiplier);
}

function calculateBattleExp() {
    let totalExp = 0;
    G.enemyUnits.forEach(enemy => {
        if (enemy._expReward !== undefined && enemy._expReward > 0) {
            totalExp += enemy._expReward;
        } else {
            const enemyLevel = enemy.battleLevel || 1;
            let bountyMultiplier = 1.0;
            if (enemy.isBoss) bountyMultiplier = 4.0;
            else if (enemy.isSummoned) bountyMultiplier = 0.5;
            totalExp += Math.floor(enemyLevel * 40 * bountyMultiplier);
        }
    });
    return totalExp;
}

function addExpAndLevelUp(unit, expGained) {
    if (unit.hp.current <= 0) return 0;
    if (unit.battleLevel >= 100) return 0;
    unit.exp += expGained;
    let levelUpCount = 0;
    while (unit.battleLevel < 100 && unit.exp >= expToNextLevel(unit.battleLevel)) {
        const requiredExp = expToNextLevel(unit.battleLevel);
        unit.exp -= requiredExp;
        unit.battleLevel += 1;
        levelUpCount++;
        unit.freeAttributePoints = (unit.freeAttributePoints || 0) + 3;
        if (levelUpCount === 1) {
            addLog(`${unit.name} 升级了！Lv.${unit.battleLevel - 1} → Lv.${unit.battleLevel}，获得3点自由属性（可分配至种族值加值）`, 'system');
        }
    }
    if (levelUpCount > 1) {
        addLog(`${unit.name} 连续升级！当前等级 Lv.${unit.battleLevel}，共获得${levelUpCount * 3}点自由属性`, 'system');
    }
    if (levelUpCount > 0) {
        syncUnitToMvu(unit);
    }
    return levelUpCount;
}

function distributeExp() {
  if (G.expDistributed) return;
  
  const alivePlayers = G.playerUnits.filter(u => u.hp.current > 0);
  if (alivePlayers.length === 0) return;
  
  const totalExp = calculateBattleExp();
  
  addLog(`战斗胜利！总经验: ${totalExp}`, 'system');
  
  alivePlayers.forEach(unit => {
    addExpAndLevelUp(unit, totalExp);
    addLog(`${unit.name} 获得 ${totalExp} 经验值`, 'system');
  });
  
  G.expDistributed = true;
}

let isGameEnding = false;

function endGame(win) {
  if (G.phase === 'over' || isGameEnding) {
    console.log('endGame already called or in progress, skipping');
    return;
  }
  
  isGameEnding = true;
  
  G.phase = 'over';
  G.actionQueue = [];
  G.currentActingUnit = null;
  G.selectedUnit = null;
  G.selectedSkill = null;
  
if (win) {
  if (G.fusionUnits.length > 0) {
    G.fusionUnits.forEach(fusion => {
      if (fusion.preFusionSnapshots) {
        fusion.preFusionSnapshots.forEach(({ unitId, snapshot }) => {
          const existing = G.playerUnits.find(u => u.id === unitId);
          if (!existing) {
            const restored = clone(snapshot);
            restored.id = unitId;
            restored.side = 'player';
            restored.isFused = false;
            delete restored.fusionComponents;
            delete restored.preFusionSnapshots;
            delete restored.fusionActionRemaining;
            updateHPMPOnStatChange(restored);
            updatePleasureBonus(restored);
            G.playerUnits.push(restored);
          }
        });
      }
    });
    G.fusionUnits = [];
    G.playerUnits = G.playerUnits.filter(u => !u.isFused);
    updateUI();
  }
  distributeExp();
  
  setTimeout(() => {
    const uniqueSkills = getUniqueEnemySkills();
    showSkillLearnModal();
  }, 500);
} else {
  showGameOverModal(false);
}
  
  clearCombatOnlyStatusEffects();
  
  G.playerUnits.forEach(unit => {
    if (unit.hp.current <= 0) {
      unit.hp.current = 1;
    }
  });
  
  updateUI();
  
  const statsButton = document.getElementById('btn-show-all-stats');
  if (statsButton) {
    statsButton.style.display = 'none';
  }
  
  const endTurnBtn = document.getElementById('btn-end-turn');
  const skipBtn = document.getElementById('btn-skip');
  if (endTurnBtn) endTurnBtn.disabled = true;
  if (skipBtn) skipBtn.disabled = true;
  
  savePlayerState().catch(e => console.error('保存失败:', e));
  
  setTimeout(() => {
    isGameEnding = false;
  }, 1000);
}

const PRESERVE_ON_BATTLE_END = [
  /^寄生/,/^产卵/,/淫纹$/,"膨乳","强制泌乳","怀孕"
];  


function shouldPreserveStatus(statusName) {
  if (!statusName) return false;
  for (const pattern of PRESERVE_ON_BATTLE_END) {
    if (typeof pattern === 'string') {
      if (statusName === pattern) return true;
    } else if (pattern instanceof RegExp) {
      if (pattern.test(statusName)) return true;
    }
  }
  return false;
}

function clearCombatOnlyStatusEffects() {
    G.playerUnits.forEach(unit => {
        const transformBuff = unit.buffs.find(b => b.isTransform === true);
        if (transformBuff && transformBuff._originalNewStats) {
            const orig = transformBuff._originalNewStats;
            unit.atk.base = orig.atk;
            unit.matk = orig.matk;
            unit.def = orig.def;
            unit.spd = orig.spd;
            unit.hp.max = orig.hpMax;
            unit.mp.max = orig.mpMax;
            if (unit.hp.current > unit.hp.max) unit.hp.current = unit.hp.max;
            if (unit.mp.current > unit.mp.max) unit.mp.current = unit.mp.max;
            if (transformBuff._originalStats && unit.stats) {
                unit.stats.constitution = transformBuff._originalStats.constitution;
                unit.stats.intelligence = transformBuff._originalStats.intelligence;
                unit.stats.agility = transformBuff._originalStats.agility;
            }
            delete unit._originalNewStats;
            delete unit._originalStats;
            addLog(`${unit.name} 的变身效果解除（战斗结束）`, 'system');
        }

        if (unit.pregnancySystem?.isActive && unit.pregnancySystem?.type === 'parasite') {
            unit.debuffs = unit.debuffs.filter(debuff => 
                shouldPreserveStatus(debuff.name) || debuff.name === '孕育'
            );
        } else {
            unit.debuffs = unit.debuffs.filter(debuff => shouldPreserveStatus(debuff.name));
        }
        
        if (PRESERVE_ON_BATTLE_END.length > 0) {
            unit.buffs = unit.buffs.filter(buff => shouldPreserveStatus(buff.name));
        } else {
            unit.buffs = [];
        }
        
        if (unit.ac && unit.ac.length > 0) {
            unit.ac = unit.ac.filter(ac => {
                if (shouldPreserveStatus(ac.source)) return true;
                const isPermanent = ac.isPermanent === true || 
                                   ac.source === '天生护甲' || 
                                   ac.source === '装备护甲';
                return isPermanent;
            });
        }
        
        unit.isStunned = false;
        unit.isTaunting = false;
        unit.isRestrained = false;
        unit.restraint = 0;
        unit.pleasure.damageBonus = 0;
        unit.pleasure.current = Math.min(unit.pleasure.current, unit.pleasure.max);

        delete unit._pendingOrgasm;
        delete unit._chastityAccumulated;
        delete unit._originalSkills;
        delete unit._originalLearnedSkills;
        delete unit._originalEquippedSkills;
        delete unit._hasExtraAction;
        delete unit.transformStage;
        delete unit.transformBonus;
        
        if (unit._originalPortraitUrl) {
            unit.portraitUrl = unit._originalPortraitUrl;
            delete unit._originalPortraitUrl;
        }
    });
    
    G.enemyUnits.forEach(enemy => {
        enemy.debuffs = [];
        enemy.buffs = [];
        enemy.ac = [];
        delete enemy.selectedSpecialSkill;
        delete enemy._pendingOrgasm;
        delete enemy._chastityAccumulated;
        delete enemy._originalSkills;
        delete enemy._originalLearnedSkills;
        delete enemy._originalEquippedSkills;
    });
}

function getValidTargets(attacker, skill) {
  let targets = [];
  if (!skill.targetType) {
    const enemyTargets = attacker.side === 'player' ? G.enemyUnits : G.playerUnits;
    targets = enemyTargets.filter(u => u.hp.current > 0);
  } else {
    const hasMindControl = attacker.debuffs && attacker.debuffs.some(d => 
      d.name === '混乱' || d.name === '魅惑'
    );
    
    if (hasMindControl && (skill.targetType === 'single_enemy' || skill.targetType === 'all_enemies')) {
      const friendlyTargets = attacker.side === 'player' ? G.playerUnits : G.enemyUnits;
      const aliveFriendly = friendlyTargets.filter(u => u.hp.current > 0);
      
      if (aliveFriendly.length === 0) {
        const enemyTargets = attacker.side === 'player' ? G.enemyUnits : G.playerUnits;
        targets = enemyTargets.filter(u => u.hp.current > 0);
      } else {
        const randomIndex = Math.floor(Math.random() * aliveFriendly.length);
        const chosen = aliveFriendly[randomIndex];
        targets = [chosen];
        
        const isConfused = attacker.debuffs.some(d => d.name === '混乱');
        const isCharmed = attacker.debuffs.some(d => d.name === '魅惑');
        if (chosen === attacker) {
          if (isConfused) {
            addLog(`陷入混乱的${attacker.name}攻击了自己！`, 'system');
          } else if (isCharmed) {
            addLog(`陷入魅惑的${attacker.name}攻击了自己！`, 'system');
          }
        } else {
          if (isConfused) {
            addLog(`陷入混乱的${attacker.name}攻击了同伴 ${chosen.name}！`, 'system');
          } else if (isCharmed) {
            addLog(`陷入魅惑的${attacker.name}攻击了同伴 ${chosen.name}！`, 'system');
          }
        }
      }
    } else {
      const attackerSide = attacker.side;
      switch (skill.targetType) {
        case 'single_enemy': {
          const enemyTargets = attackerSide === 'player' ? G.enemyUnits : G.playerUnits;
          const tauntTargets = enemyTargets.filter(u => u.isTaunting && u.hp.current > 0);
          const aliveEnemies = enemyTargets.filter(u => u.hp.current > 0);
          targets = tauntTargets.length > 0 ? tauntTargets : aliveEnemies;
          break;
        }
        case 'all_enemies':
          targets = (attackerSide === 'player' ? G.enemyUnits : G.playerUnits).filter(u => u.hp.current > 0);
          break;
        case 'single_ally':
          targets = (attackerSide === 'player' ? G.playerUnits : G.enemyUnits).filter(u => u.hp.current > 0);
          break;
        case 'all_allies':
          targets = (attackerSide === 'player' ? G.playerUnits : G.enemyUnits).filter(u => u.hp.current > 0);
          break;
        case 'random_enemy': {
          const pool = (attackerSide === 'player' ? G.enemyUnits : G.playerUnits).filter(u => u.hp.current > 0);
          targets = pool.length > 0 ? [pool[Math.floor(Math.random() * pool.length)]] : [];
          break;
        }
        case 'self':
          targets = [attacker];
          break;
        default:
          targets = [];
      }
    }
  }
  
  if (skill.requirements?.target && targets.length > 0) {
    targets = targets.filter(target => canUseSkillOnTarget(attacker, target, skill));
  }
  
  return targets;
}

function removeRestraint(unit) {
  unit.isRestrained = false;
  unit.restraint = 0;
  if (unit._originalSkills) {
    unit.skills = unit._originalSkills;
    unit.learnedSkills = unit._originalLearnedSkills;
    unit.equippedSkills = unit._originalEquippedSkills;
    delete unit._originalSkills;
    delete unit._originalLearnedSkills;
    delete unit._originalEquippedSkills;
  }
  unit.debuffs = unit.debuffs.filter(d => d.name !== '拘束');
  addLog(`${unit.name}摆脱了拘束！`, 'system');
}

function getStatusDefinition(statusName) {
  const defs = worldbookData.statusEffects;
  if (!defs || !statusName) return null;

  if (Array.isArray(defs)) {
    return defs.find(s => s && (s.name === statusName || s.id === statusName)) || null;
  }

  if (defs[statusName]) return defs[statusName];

  const possibleArrays = [
    defs.statusEffects,
    defs.effects,
    defs.statuses,
    defs['状态效果'],
    defs['状态效果定义'],
    defs['状态列表']
  ];

  for (const arr of possibleArrays) {
    if (Array.isArray(arr)) {
      const found = arr.find(s => s && (s.name === statusName || s.id === statusName));
      if (found) return found;
    }
  }

  const values = Object.values(defs);
  for (const value of values) {
    if (value && typeof value === 'object') {
      if (value.name === statusName || value.id === statusName) return value;

      if (Array.isArray(value)) {
        const found = value.find(s => s && (s.name === statusName || s.id === statusName));
        if (found) return found;
      }
    }
  }

  return null;
}

function outputStunLog(unit) {
  const stunStatus = [...(unit.buffs || []), ...(unit.debuffs || [])].find(s => 
    s.effects && s.effects.some(e => e.stat === 'stun')
  );
  const statusName = stunStatus?.name || '眩晕';
  
  const isMale = unit.gender === 'male' || unit.gender === '男' || unit.gender === 'm';
  const isOrgasmStun = statusName === '高潮恍惚';
  
  if (isMale && isOrgasmStun) {
    addLog(`${unit.name}因${statusName}状态，无法行动！`, 'system');
    return;
  }
  
  const def = getStatusDefinition(statusName) || {};
  const logs = def.actionLogs || def.customLogs || [];
  const text = getRandomFromArray(logs);
  
  if (text) {
    addLog(formatBattleText(text, { unit }), 'system');
  } else {
    addLog(`${unit.name}因${statusName}状态，无法行动！`, 'system');
  }
}

function getRandomFromArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatBattleText(text, data = {}) {
  if (!text) return '';
  return text
    .replace(/\{unit\}/g, data.unit?.name || '')
    .replace(/\{target\}/g, data.target?.name || data.defender?.name || data.unit?.name || '')
    .replace(/\{source\}/g, data.source?.name || data.sourceName || '')
    .replace(/\{attacker\}/g, data.attacker?.name || '')
    .replace(/\{defender\}/g, data.defender?.name || '');
}

function createStatusEffect(statusName, fallback, context = {}) {
  const def = getStatusDefinition(statusName) || {};
  
  const stateDuration = fallback.duration ?? def.duration ?? 1;
  
  const processedEffects = (fallback.effects || def.effects || []).map(e => {
    const newEffect = { ...e };
    if (newEffect.duration === undefined && stateDuration !== undefined) {
      newEffect.duration = stateDuration;
    }
    return newEffect;
  });
  
  return {
    name: statusName,
    description: def.description || fallback.description || '',
    duration: stateDuration,
    type: fallback.type || def.type || 'buff',
    effects: processedEffects,
    customLogs: fallback.customLogs || def.customLogs || def.actionLogs || [],
    sourceName: context.source?.name || fallback.sourceName || null,
    sourceSide: context.source?.side || fallback.sourceSide || null,
    sourceSnapshot: context.source ? clone(context.source) : fallback.sourceSnapshot || null,
    ...fallback.extra
  };
}

function logStatusActionText(unit) {
  const statuses = [...(unit.buffs || []), ...(unit.debuffs || [])];
  const loggedStatusNames = new Set();

  statuses.forEach(status => {
    if (!status || !status.name) return;

    // 同名状态本次行动开始只输出一次
    if (loggedStatusNames.has(status.name)) return;
    loggedStatusNames.add(status.name);

    const def = window.getStatusDefinition
      ? (window.getStatusDefinition(status.name) || {})
      : (getStatusDefinition(status.name) || {});

    const logs =
      status.actionLogs ||
      status.customLogs ||
      def.actionLogs ||
      def.customLogs ||
      [];

    const text = getRandomFromArray(logs);

    if (text) {
      addLog(formatBattleText(text, {
        unit,
        sourceName: status.sourceName
      }), 'system');
    }
  });
}

function getFinalAccuracy(unit) {
  let value = Number(unit.accuracy);
  if (!Number.isFinite(value)) value = 0;

  [...(unit.buffs || []), ...(unit.debuffs || [])].forEach(status => {
    (status.effects || []).forEach(effect => {
      if (effect.stat === 'accuracy') value += Number(effect.value) || 0;
    });
  });

  return value;
}

function getFinalEvasion(unit) {
  let value = Number(unit.evasion);
  if (!Number.isFinite(value)) value = 0;

  [...(unit.buffs || []), ...(unit.debuffs || [])].forEach(status => {
    (status.effects || []).forEach(effect => {
      if (effect.stat === 'evasion') value += Number(effect.value) || 0;
    });
  });

  return value;
}

function checkSkillHit(attacker, defender, skill) {
  const skillHit = Number.isFinite(Number(skill.hit)) ? Number(skill.hit) : 100;
  const attackerAccuracy = getFinalAccuracy(attacker);
  const defenderEvasion = getFinalEvasion(defender);
  const finalHit = Math.max(0, Math.min(100, skillHit + attackerAccuracy - defenderEvasion));
  const roll = Math.floor(Math.random() * 100) + 1;

  if (roll > finalHit) {
    addLog(`${defender.name}回避了攻击`, 'system');
    return false;
  }

  return true;
}

function getFrontEndMasturbationSkill() {
  const data = EROSION_SKILLS.find(s => s.name === '自慰');
  return data ? buildErosionSkillObject({ ...data, unlocked: true, currentErosion: Infinity }) : null;
}

const AROUSAL_FORCED_MASTURBATION_LOGS = [
  '{unit}发情了！呼吸变得急促，身体不受控制地追逐着快感。',
  '{unit}被发情状态吞没，理智短暂地让位给本能。',
  '{unit}发情了！双眼迷离，难以压抑体内翻涌的情欲。',
  '{unit}发情了！动作变得慌乱而急切，仿佛已经听不见周围的战斗声。'
];

function getRandomArousalForcedLog(unit) {
  const text = getRandomFromArray(AROUSAL_FORCED_MASTURBATION_LOGS);
  return formatBattleText(text, { unit });
}

function hasStatus(unit, statusName) {
  return [...(unit.buffs || []), ...(unit.debuffs || [])].some(s => s.name === statusName);
}

function getOrInitConsciousness(unit) {
  if (!unit.consciousnessSystem) {
    unit.consciousnessSystem = {
      awarenessValue: 25,
      hypnosisValue: 0,
      maxHypnosisValue: 100,
      thresholds: { bodyControl: 65, commonSense: 100 },
      currentState: 'normal',
      corruptionRatePerPoint: 0.02,
      maxCorruptionRate: 0.9
    };
  }
  return unit.consciousnessSystem;
}

function addOrStackDebuff(unit, statusName, payload = {}) {
  unit.debuffs = unit.debuffs || [];
  
  // 检查是否可叠加
  const stackable = isStackableStatus(statusName, payload);
  
  if (!stackable) {
    const found = unit.debuffs.find(d => d.name === statusName);
    if (found) {
      if (payload.refreshDuration && found.duration !== -1) {
        found.duration = Math.max(found.duration || 0, payload.refreshDuration);
        if (found.effects) {
          found.effects.forEach(effect => {
            if (effect.duration !== undefined && effect.duration !== -1) {
              effect.duration = found.duration;
            }
          });
        }
      }
      return found;
    }
    
    const processedEffects = (payload.effects || []).map(e => {
      const newEffect = { ...e };
      if (newEffect.duration === undefined && payload.duration !== undefined) {
        newEffect.duration = payload.duration;
      }
      return newEffect;
    });
    
    const created = {
      name: statusName,
      description: payload.description || '',
      duration: payload.duration ?? 1,
      type: 'debuff',
      stackable: false,
      effects: processedEffects,
      tags: payload.tags || []
    };
    unit.debuffs.push(created);
    return created;
  }
  
  const config = {
    ...payload,
    type: 'debuff',
    displayName: payload.displayName || statusName,
    layers: payload.addStack || payload.layers || 1,
    duration: payload.duration || 3,
    maxLayers: payload.maxLayers || 10,
    effects: payload.effects || [],
    thresholdEffects: payload.thresholdEffects || []
  };
  
  return addStackableStatus(unit, statusName, config, { name: payload.sourceName || '未知', side: unit.side });
}


function removeDebuffsByRule(unit, ruleFn) {
  const before = unit.debuffs.length;
  unit.debuffs = unit.debuffs.filter(d => !ruleFn(d));
  return before - unit.debuffs.length;
}

function updateArousalStatus(unit) {
  if (!unit || unit.side !== 'player' || !unit.pleasure) return;

  const hasArousal = hasStatus(unit, '发情');
  const threshold = unit.pleasure.max * 0.7;

  if (unit.pleasure.current >= threshold && unit.pleasure.current < unit.pleasure.max && !hasArousal) {
    unit.debuffs.push(createStatusEffect('发情', {
      description: '情欲高涨，行动可能失控',
      remainingActions: -1,
      type: 'debuff',
      effects: []
    }, { source: unit }));
    addLog(`${unit.name}进入了发情状态`, 'pleasure');
  }
}

function applyOrRefreshMentalState(unit) {
  const cs = getOrInitConsciousness(unit);
  const old = cs.currentState || 'normal';
  let next = 'normal';
  
  if (cs.hypnosisValue >= 100) next = 'commonSense';      
  else if (cs.hypnosisValue >= 65) next = 'bodyControl'; 

  if (old === next) return;
  cs.currentState = next;

  unit.debuffs = unit.debuffs.filter(d => d.name !== '身体操作状态' && d.name !== '常识篡改状态');

  if (next === 'bodyControl') {

    unit.debuffs.push({
        name: '身体操作状态',
        description: '技能有概率被篡改为H技能',
        duration: -1,
        type: 'debuff',
        effects: [{ stat: 'pleasure_damage_taken', value: 0.3, duration: -1 }],
        tags: ['debuff', 'mental']
    });
    addLog(`${unit.name}进入身体操作状态（催眠值 ${cs.hypnosisValue}）`, 'system');
  } else if (next === 'commonSense') {
    unit.debuffs.push({
        name: '常识篡改状态',
        description: '仅可使用情欲技能',
        duration: -1,
        type: 'debuff',
        effects: [
            { stat: 'pleasure_damage_taken', value: 0.5, duration: -1 },
            { stat: 'pleasure_dot', value: 10, duration: -1 }
        ],
        tags: ['debuff', 'mental']
    });
    addLog(`${unit.name}进入常识篡改状态（催眠值 100）`, 'system');
  }

  updatePleasureBonus(unit);
}

function getLustSealStack(unit) {
  const d = (unit.debuffs || []).find(x => x.name === '淫纹');
  return d ? (d.stacks || 1) : 0;
}

function removeArousalStatus(unit) {
  if (!unit || !unit.debuffs) return;
  unit.debuffs = unit.debuffs.filter(d => d.name !== '发情');
}

function summonUnitFromStatus(status) {
  const sourceSide = status.sourceSide;
  const targetList = sourceSide === 'player' ? G.playerUnits : G.enemyUnits;
  const maxCount = sourceSide === 'player' ? 6 : 4;

  if (!sourceSide || targetList.length >= maxCount) return;

  let template = status.sourceSnapshot;

  if (!template && sourceSide === 'player') {
    template = G.playerUnits.find(u => u.name === status.sourceName)
      || window.loadedPlayers?.find(u => u.name === status.sourceName);
  }

  if (!template && sourceSide === 'enemy') {
    template = G.enemyUnits.find(u => u.name === status.sourceName)
      || window.loadedEnemies?.find(u => u.name === status.sourceName);
  }

  if (!template) {
    addLog(`产卵状态结束，但未找到来源单位模板：${status.sourceName}`, 'system');
    return;
  }

  const summoned = clone(template);
  summoned.id = `spawn_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  summoned.side = sourceSide;
  summoned.isSummoned = true;
  summoned.actionDistance = 0;
  summoned.nextActionPoint = 0;
  summoned.buffs = [];
  summoned.debuffs = [];
  summoned.ac = summoned.ac || [];
  summoned.hp = summoned.hp || { current: 100, max: 100 };
  summoned.mp = summoned.mp || { current: 50, max: 50 };
  summoned.pleasure = summoned.pleasure || { current: 0, max: 100, damageBonus: 0 };

  targetList.push(summoned);
  addLog(`${status.sourceName}的产卵完成，${summoned.name}被召唤到${sourceSide === 'player' ? '我方' : '敌方'}场上`, 'system');

  updateUI();
  recalculateActionOrder();
}

function triggerCounter(defender, attacker, triggeringSkill) {
  if (!defender || !attacker || triggeringSkill?.isCounterAttack) return;
  if (defender.hp.current <= 0 || attacker.hp.current <= 0) return;

  const counterStatus = [...(defender.buffs || []), ...(defender.debuffs || [])]
    .find(status => (status.effects || []).some(effect => effect.type === 'counter' || effect.stat === 'counter'));

  if (!counterStatus) return;

  const counterEffect = counterStatus.effects.find(effect => effect.type === 'counter' || effect.stat === 'counter');
  const multiplier = Number(counterEffect.multiplier ?? counterEffect.value ?? 1);
  const baseAtk = calculateBaseATK(defender);
  const agi = getFinalStat(defender, 'agility');
  const damage = Math.floor(baseAtk * multiplier * (1 + agi * 0.035));

  const actualDamage = applyDamage(attacker, damage, false);
  addLog(`${defender.name}发动反击，${attacker.name}减少了${actualDamage}点体力`, 'damage');
  showFloat(attacker, `-${actualDamage}`, 'damage');
  checkDeath(attacker);
}


window.getStatusDefinition = function(statusName) {
  const defs = worldbookData.statusEffects;
  if (!defs || !statusName) return null;

  if (Array.isArray(defs)) {
    return defs.find(s => s && (s.name === statusName || s.id === statusName)) || null;
  }

  if (defs[statusName]) return defs[statusName];

  const possibleArrays = [
    defs.statusEffects,
    defs.effects,
    defs.statuses,
    defs['状态效果'],
    defs['状态效果定义'],
    defs['状态列表']
  ];

  for (const arr of possibleArrays) {
    if (Array.isArray(arr)) {
      const found = arr.find(s => s && (s.name === statusName || s.id === statusName));
      if (found) return found;
    }
  }

  for (const value of Object.values(defs)) {
    if (value && typeof value === 'object') {
      if (value.name === statusName || value.id === statusName) return value;

      if (Array.isArray(value)) {
        const found = value.find(s => s && (s.name === statusName || s.id === statusName));
        if (found) return found;
      }
    }
  }

  return null;
};

function hasStatusDuplicate(unit, statusName) {
  if (!NO_DUPLICATE_DEBUFFS.includes(statusName)) {
    return false; 
  }
  
  const exists = [...(unit.debuffs || []), ...(unit.buffs || [])]
    .some(s => s.name === statusName);
  
  if (exists) {
    return true;
  }
  
  return false;
}

function applyEffect(target, effect, source) {
  switch (effect.type) {
        case 'special_energy_gain': {
  const typeName = effect.typeName || '通用';
  const amount = effect.amount || 0;
  let targets = [target];   

  if (effect.target === 'self') {
    targets = [source];     
  } else if (effect.target === 'all_allies') {
    targets = source.side === 'player' ? G.playerUnits : G.enemyUnits;
    targets = targets.filter(u => u.hp.current > 0);
  } else if (effect.target === 'all_enemies') {
    targets = source.side === 'player' ? G.enemyUnits : G.playerUnits;
    targets = targets.filter(u => u.hp.current > 0);
  }
  targets.forEach(t => {
    if (!t.specialEnergy) t.specialEnergy = {};
    if (!t.specialEnergy[typeName]) {
      const max = effect.max || 100;
      t.specialEnergy[typeName] = { current: 0, max: max };
    }
    t.specialEnergy[typeName].current = Math.min(
      t.specialEnergy[typeName].current + amount,
      t.specialEnergy[typeName].max
    );
    addLog(`${t.name} 获得 ${amount} 点 ${typeName} 能量`, 'system');
  });
  break;
}

        case 'special_energy_cost': {
            const typeName = effect.typeName || '通用';
            const amount = effect.amount || 0;
            if (target.specialEnergy?.[typeName]) {
                target.specialEnergy[typeName].current = Math.max(
                    0,
                    target.specialEnergy[typeName].current - amount
                );
                addLog(`${target.name} 消耗 ${amount} 点 ${typeName} 能量`, 'system');
            }
            break;
        }

        case 'transform':
            applyTransformEffect(target, effect, source);
            break;

case 'damage_taken_multiplier':
    target.buffs.push({
        name: effect.name || (effect.value > 0 ? '易伤' : '减伤'),
        description: `${effect.value > 0 ? '增加' : '减少'}${Math.abs(effect.value * 100)}%受到的伤害`,
        duration: effect.duration,
        type: effect.value > 0 ? 'debuff' : 'buff',
        effects: [{ stat: 'damage_taken_multiplier', value: effect.value, duration: effect.duration }]
    });
    addLog(`${target.name}的受到的伤害${effect.value > 0 ? '增加' : '减少'}了${Math.abs(effect.value * 100)}%`, 'system');
    break;

case 'invincible': {
    const mode = effect.mode || 'turn';   
    const value = effect.value || 1;      
    
    if (mode === 'turn') {
        target.buffs.push({
            name: '无敌',
            description: `免疫所有技能伤害，持续 ${value} 回合`,
            duration: value,
            type: 'buff',
            invincible: true,
            invincibleMode: 'turn',
            effects: []   
        });
        addLog(`${target.name} 获得了无敌状态，持续 ${value} 回合！`, 'system');
    } else if (mode === 'count') {
        const config = {
            name: '无敌',
            displayName: '无敌',
            type: 'buff',
            stackable: true,
            layers: value,
            maxLayers: 99,
            duration: -1,          
            consumeOnAttack: true, 
            effects: [],
            customLogs: ['{attacker}的无敌护盾抵消了伤害！']
        };
        addStackableStatus(target, '无敌', config, source);
        addLog(`${target.name} 获得了 ${value} 次无敌护盾！`, 'system');
    }
    break;
}

    case 'extra_action':
      if (!source._extraActionUsedThisTurn) {
        source._extraActionPending = true;
        source._extraActionUsedThisTurn = true;
        addLog(`${source.name}获得了再次行动的机会！`, 'system');
      }
      break;

    case 'armor_restraint_reduce':
  if (target.debuffs) {
    const armorDebuff = target.debuffs.find(d => d.name === '肉铠拘束');
    if (armorDebuff) {
      if (armorDebuff.armorRestraint === undefined) armorDebuff.armorRestraint = 100;
      armorDebuff.armorRestraint = Math.max(0, armorDebuff.armorRestraint - effect.value);
      addLog(`${target.name}的铠甲拘束度减少${effect.value}，当前${armorDebuff.armorRestraint}`, 'system');
          if (armorDebuff.armorRestraint <= 0) {
            const caster = [...G.playerUnits, ...G.enemyUnits].find(u => u.id === armorDebuff.casterId);
            if (caster) {
              const armorAC = caster.ac.find(ac => ac.source === '肉铠护甲');
              if (armorAC) {
                const idx = caster.ac.indexOf(armorAC);
                if (idx !== -1) caster.ac.splice(idx, 1);
                addLog(`${caster.name}的铠甲护甲因${target.name}挣脱而消失`, 'system');
              }
            }
            const idx = target.debuffs.indexOf(armorDebuff);
            if (idx !== -1) target.debuffs.splice(idx, 1);
            addLog(`${target.name}成功挣脱了肉铠拘束！`, 'system');
          }
        }
      }
      break;

case 'attack_enchantment':
    const enchantmentConfig = {
        name: effect.name || (effect.value > 0 ? '附魔' : '诅咒附魔'),
        displayName: effect.displayName || effect.name,
        description: effect.description || `攻击时附带额外效果`,
        duration: effect.duration || -1,
        type: effect.typeBuff === 'buff' ? 'buff' : 'debuff',
        stackable: effect.stackable || false,
        layers: effect.layers || 1,
        maxLayers: effect.maxLayers || 1,
        onAttackEffects: effect.onAttackEffects || [],   
        consumeOnAttack: effect.consumeOnAttack || false, 
        decayOnAttack: effect.consumeOnAttack || false,   
        effects: effect.effects || [],   
        customLogs: effect.customLogs || []
    };
    
    if (enchantmentConfig.stackable) {
        addStackableStatus(target, enchantmentConfig.name, enchantmentConfig, source);
    } else {
        addLegacyStatus(target, enchantmentConfig.name, enchantmentConfig, source);
    }
    
    addLog(`${target.name}获得了附魔效果：${enchantmentConfig.displayName}`, 'system');
    break;

case 'damage_multiplier':
    target.buffs.push({
        name: effect.name || (effect.value > 0 ? '伤害强化' : '伤害弱化'),
        description: `${effect.value > 0 ? '增加' : '减少'}${Math.abs(effect.value * 100)}%造成的伤害`,
        duration: effect.duration,
        type: 'buff',
        effects: [{ stat: 'damage_multiplier', value: effect.value, duration: effect.duration }]
    });
    addLog(`${target.name}的伤害${effect.value > 0 ? '增加' : '减少'}了${Math.abs(effect.value * 100)}%`, 'system');
    break;

case 'consume_layers_damage': {
    const statusName = effect.statusName;
    const layersToConsume = effect.layersToConsume || 'all';
    const targetStatus = findStatus(target, statusName);
    
    if (!targetStatus || !targetStatus.stackable || targetStatus.totalLayers <= 0) {
        addLog(`${target.name}没有【${statusName}】状态，无法触发效果`, 'system');
        break;
    }
    
    let consumedLayers = 0;
    if (layersToConsume === 'all') {
        consumedLayers = targetStatus.totalLayers;
    } else {
        consumedLayers = Math.min(layersToConsume, targetStatus.totalLayers);
    }
    
    let damage = 0;
    if (effect.baseDamagePerLayer) {
        damage = effect.baseDamagePerLayer * consumedLayers;
    } else if (effect.multiplier) {
        const baseAtk = getUnitStat(source, 'atk');
        damage = Math.floor(baseAtk * effect.multiplier);
    }
    
    if (effect.scaleWith) {
        switch (effect.scaleWith) {
            case 'max_hp':
                damage = Math.floor(damage * (target.hp.max / 100));
                break;
            case 'current_hp':
                damage = Math.floor(damage * (target.hp.current / 100));
                break;
            case 'max_mp':
                damage = Math.floor(damage * (target.mp.max / 100));
                break;
            case 'max_pleasure':
                damage = Math.floor(damage * (target.pleasure.max / 100));
                break;
        }
    }
    
    if (effect.damageType === 'physical') {
        const atk = getUnitStat(source, 'atk');
        damage = Math.floor(damage * (1 + atk * 0.03));
    } else if (effect.damageType === 'magical') {
        const matk = getUnitStat(source, 'matk');
        damage = Math.floor(damage * (1 + matk * 0.04));
    } else if (effect.damageType === 'agile') {
        const spd = getUnitStat(source, 'spd');
        damage = Math.floor(damage * (1 + spd * 0.035));
    }
    
    damage = Math.max(1, damage);
    
    const actualDamage = applyDamage(target, damage, effect.ignoreArmor || false);
    addLog(`${source.name}消耗了${target.name}的${consumedLayers}层【${statusName}】，造成${actualDamage}点伤害！`, 'damage');
    showFloat(target, `-${actualDamage}`, 'damage');
    
    removeStackableLayers(target, statusName, consumedLayers, effect.removeOldest !== false);
    
    checkDeath(target);
    break;
}

case 'consume_self_layers_damage': {
    const statusNameSelf = effect.statusName;
    const layersToConsumeSelf = effect.layersToConsume || 'all';
    const attackerStatus = findStatus(source, statusNameSelf);
    
    if (!attackerStatus || !attackerStatus.stackable || attackerStatus.totalLayers <= 0) {
        if (effect.allowZeroLayers === true) {
            let zeroDamage = effect.baseDamagePerLayer || effect.value || 0;
            if (zeroDamage <= 0) zeroDamage = 10;
            const actualZeroDamage = applyDamage(target, zeroDamage, effect.ignoreArmor || false);
            addLog(`${source.name}的【${statusNameSelf}】层数不足，仅造成${actualZeroDamage}点伤害`, 'damage');
            showFloat(target, `-${actualZeroDamage}`, 'damage');
            checkDeath(target);
        } else {
            addLog(`${source.name}身上没有【${statusNameSelf}】状态或层数为0，无法触发效果`, 'system');
        }
        break;
    }
    
    let consumedLayersSelf = 0;
    if (layersToConsumeSelf === 'all') {
        consumedLayersSelf = attackerStatus.totalLayers;
    } else {
        consumedLayersSelf = Math.min(layersToConsumeSelf, attackerStatus.totalLayers);
    }
    
    let damageSelf = 0;
    if (effect.baseDamagePerLayer) {
        damageSelf = effect.baseDamagePerLayer * consumedLayersSelf;
    } else if (effect.multiplier) {
        const baseAtk = getUnitStat(source, 'atk');
        damageSelf = Math.floor(baseAtk * effect.multiplier);
    } else if (effect.value) {
        damageSelf = effect.value;
    } else {
        damageSelf = 10 * consumedLayersSelf;
    }
    
    if (effect.scaleWith) {
        switch (effect.scaleWith) {
            case 'max_hp': damageSelf = Math.floor(damageSelf * (target.hp.max / 100)); break;
            case 'current_hp': damageSelf = Math.floor(damageSelf * (target.hp.current / 100)); break;
            case 'max_mp': damageSelf = Math.floor(damageSelf * (target.mp.max / 100)); break;
            case 'max_pleasure': damageSelf = Math.floor(damageSelf * (target.pleasure.max / 100)); break;
        }
    }
    
    if (effect.damageType === 'physical') {
        const atk = getUnitStat(source, 'atk');
        damageSelf = Math.floor(damageSelf * (1 + atk * 0.03));
    } else if (effect.damageType === 'magical') {
        const matk = getUnitStat(source, 'matk');
        damageSelf = Math.floor(damageSelf * (1 + matk * 0.04));
    } else if (effect.damageType === 'agile') {
        const spd = getUnitStat(source, 'spd');
        damageSelf = Math.floor(damageSelf * (1 + spd * 0.035));
    }
    
    damageSelf = Math.max(1, damageSelf);
    const actualDamageSelf = applyDamage(target, damageSelf, effect.ignoreArmor || false);
    addLog(`${source.name}消耗了自身${consumedLayersSelf}层【${statusNameSelf}】，对${target.name}造成${actualDamageSelf}点额外伤害！`, 'damage');
    showFloat(target, `-${actualDamageSelf}`, 'damage');
    
    removeStackableLayers(source, statusNameSelf, consumedLayersSelf, effect.removeOldest !== false);
    checkDeath(target);
    break;
}

case 'heal_by_damage':
    break;

case 'restore_mp_by_damage':
    break;

case 'restore_ac_by_damage':
    break;

case 'restore_pleasure_by_damage':
    break;

    case 'oviposition':
case '产卵':
  target.debuffs.push(createStatusEffect('产卵', {
    description: `倒计时结束后召唤来源单位：${source.name}（${source.side === 'player' ? '我方' : '敌方'}）`,
    duration: effect.duration || 1,
    type: 'debuff',
    effects: [{ stat: 'oviposition', value: 1, duration: effect.duration || 1 }],
    extra: {
      sourceName: source.name,
      sourceSide: source.side,
      sourceSnapshot: clone(source)
    }
  }, { source }));
  addLog(`${target.name}被施加了产卵状态，来源：${source.name}（${source.side === 'player' ? '我方' : '敌方'}）`, 'system');
  break;

case 'repair_clothing':
case 'clothing_restore':
  if (target.clothingIntegrity !== undefined) {
    const oldValue = target.clothingIntegrity;
    let restoreAmount = effect.value || 0;
    
    if (effect.percent) {
      restoreAmount = Math.floor(100 * (effect.percent / 100));
    }
    
    target.clothingIntegrity = Math.min(100, target.clothingIntegrity + restoreAmount);
    addLog(`${target.name}的服装恢复了${restoreAmount}%耐久度（${oldValue}% → ${target.clothingIntegrity}%）`, 'system');
    showFloat(target, `服装+${restoreAmount}%`, 'buff');
  }
  break;

    case 'counter':
      target.buffs.push(createStatusEffect('反击', {
        description: `受到攻击时以敏捷伤害反击，倍率${effect.multiplier ?? effect.value ?? 1}`,
        remainingActions: effect.duration ?? -1,
        type: 'buff',
        effects: [{ type: 'counter', stat: 'counter', value: effect.value ?? 1, multiplier: effect.multiplier ?? effect.value ?? 1, duration: effect.duration ?? -1 }]
      }, { source }));
      break;

case 'confusion':
case 'charm':
    if (hasStatusDuplicate(target, effect.type === 'confusion' ? '混乱' : '魅惑')) {
        break;
    }
    
    target.debuffs.push({
        name: effect.type === 'confusion' ? '混乱' : '魅惑',
        description: effect.type === 'confusion' ? '敌我不分，攻击己方单位' : '被魅惑，攻击己方单位',
        duration: effect.duration || 2,
        type: 'debuff',
        effects: [
            { stat: 'confusion', value: 1, duration: effect.duration || 2 }
        ],
        customLogs: effect.type === 'confusion' 
            ? ['{unit}陷入混乱，无法识别敌我'] 
            : ['{unit}被魅惑了，双眼泛起桃心']
    });
    if (!effect._fromThreshold) {
        addLog(`${target.name}${effect.type === 'confusion' ? '陷入混乱状态' : '被魅惑了'}！`, 'system');
    }
    break;

    case 'accuracy_up':
      target.buffs.push(createStatusEffect('命中上升', {
        description: `命中增加${effect.value}`,
        remainingActions: effect.duration || 1,
        type: 'buff',
        effects: [{ stat: 'accuracy', value: effect.value || 0, duration: effect.duration || 1 }]
      }, { source }));
      break;

    case 'evasion_up':
      target.buffs.push(createStatusEffect('闪避上升', {
        description: `回避增加${effect.value}`,
        remainingActions: effect.duration || 1,
        type: 'buff',
        effects: [{ stat: 'evasion', value: effect.value || 0, duration: effect.duration || 1 }]
      }, { source }));
      break;

case 'bleed':
    target.debuffs.push({
        name: '流血',
        description: `每回合减少${effect.value}点体力`,
        duration: effect.duration,  // 改这里
        type: 'debuff',
        effects: [{ stat: 'bleed', value: effect.value, duration: effect.duration }]
    });
    break;

case 'burn':
    target.debuffs.push({
        name: '灼烧',
        description: `每回合减少${effect.value}点体力`,
        duration: effect.duration,  // 改这里
        type: 'debuff',
        effects: [{ stat: 'burn', value: effect.value, duration: effect.duration }]
    });
    break;

case 'pleasure_up':
    target.debuffs.push({
        name: `情欲提升`,
        description: `受到的情欲伤害+${effect.value * 100}%`,
        duration: effect.duration,  // 改这里
        type: 'debuff',
        effects: [{ stat: 'pleasure_damage_taken', value: effect.value, duration: effect.duration }]
    });
    updatePleasureBonus(target);
    break;

    case 'struggle_hp_loss':
      const hpLoss = Math.floor(target.hp.max * 0.05);
      target.hp.current = Math.max(0, target.hp.current - hpLoss);
      addLog(`${target.name}挣扎，损失了${hpLoss}点生命值`, 'damage');
      break;

case 'remove_self_layers':
    const selfStatusName = effect.statusName;
    let selfLayersToRemove = effect.layersToRemove || 'all';
    const selfStatus = findStatus(source, selfStatusName);
    if (selfStatus && selfStatus.stackable && selfStatus.totalLayers > 0) {
        let removed = 0;
        if (selfLayersToRemove === 'all') {
            removed = selfStatus.totalLayers;
        } else {
            removed = Math.min(selfLayersToRemove, selfStatus.totalLayers);
        }
        removeStackableLayers(source, selfStatusName, removed, effect.removeOldest !== false);
        if (!effect._fromThreshold) {
            addLog(`${source.name}消耗了${removed}层【${selfStatusName}】`, 'system');
        }
    } else {
        if (!effect._fromThreshold) {
            addLog(`${source.name}没有可移除的【${selfStatusName}】层数`, 'system');
        }
    }
    break;

case 'remove_target_layers':
    const targetStatusName = effect.statusName;
    const targetLayersToRemove = effect.layersToRemove || 'all';
    const targetStatus = findStatus(target, targetStatusName);
    if (targetStatus && targetStatus.stackable && targetStatus.totalLayers > 0) {
        let removed = 0;
        if (targetLayersToRemove === 'all') {
            removed = targetStatus.totalLayers;
        } else {
            removed = Math.min(targetLayersToRemove, targetStatus.totalLayers);
        }
        removeStackableLayers(target, targetStatusName, removed, effect.removeOldest !== false);
        addLog(`${target.name}失去了${removed}层【${targetStatusName}】`, 'system');
    } else {
    }
    break;

case 'deal_damage':
    let targetForDamage = target;
    if (effect.target === 'self') targetForDamage = source;
    let pureDamage = effect.value || 0;
    if (effect.percent) {
        pureDamage = Math.floor(targetForDamage.hp.max * (effect.percent / 100));
    }
    if (effect.scaleWith === 'atk') {
        pureDamage += calculateBaseATK(source);
    }
    if (effect.scaleWith === 'pleasure') {
        pureDamage += targetForDamage.pleasure.current;
    }
    pureDamage = Math.max(1, pureDamage);
    const actualPureDamage = applyDamage(targetForDamage, pureDamage, effect.ignoreArmor || false);
    addLog(`${source.name}对${targetForDamage.name}造成了${actualPureDamage}点额外伤害！`, 'damage');
    showFloat(targetForDamage, `-${actualPureDamage}`, 'damage');
    checkDeath(targetForDamage);
    break;

case 'consume_self_layers_damage':
    // 消耗攻击者（source）自身的可叠加状态层数，对目标（target）造成伤害
    const statusNameSelf = effect.statusName;
    const layersToConsumeSelf = effect.layersToConsume || 'all';
    const attackerStatus = findStatus(source, statusNameSelf);
    
    if (!attackerStatus || !attackerStatus.stackable || attackerStatus.totalLayers <= 0) {
        if (effect.allowZeroLayers === true) {
            let zeroDamage = effect.baseDamagePerLayer || effect.value || 0;
            if (zeroDamage <= 0) zeroDamage = 10;
            const actualZeroDamage = applyDamage(target, zeroDamage, effect.ignoreArmor || false);
            addLog(`${source.name}的【${statusNameSelf}】层数不足，仅造成${actualZeroDamage}点伤害`, 'damage');
            showFloat(target, `-${actualZeroDamage}`, 'damage');
            checkDeath(target);
        } else {
            addLog(`${source.name}身上没有【${statusNameSelf}】状态或层数为0，无法触发效果`, 'system');
        }
        break;
    }
    
    let consumedLayersSelf = 0;
    if (layersToConsumeSelf === 'all') {
        consumedLayersSelf = attackerStatus.totalLayers;
    } else {
        consumedLayersSelf = Math.min(layersToConsumeSelf, attackerStatus.totalLayers);
    }
    
    let damageSelf = 0;
    if (effect.baseDamagePerLayer) {
        damageSelf = effect.baseDamagePerLayer * consumedLayersSelf;
    } else if (effect.multiplier) {
        const baseAtk = calculateBaseATK(source);
        damageSelf = Math.floor(baseAtk * effect.multiplier);
    } else if (effect.value) {
        damageSelf = effect.value;
    } else {
        damageSelf = 10 * consumedLayersSelf; 
    }
    
    if (effect.scaleWith) {
        switch (effect.scaleWith) {
            case 'max_hp': damageSelf = Math.floor(damageSelf * (target.hp.max / 100)); break;
            case 'current_hp': damageSelf = Math.floor(damageSelf * (target.hp.current / 100)); break;
            case 'max_mp': damageSelf = Math.floor(damageSelf * (target.mp.max / 100)); break;
            case 'max_pleasure': damageSelf = Math.floor(damageSelf * (target.pleasure.max / 100)); break;
        }
    }
    
    if (effect.damageType === 'physical') {
        const con = getFinalStat(source, 'constitution');
        damageSelf = Math.floor(damageSelf * (1 + con * 0.03));
    } else if (effect.damageType === 'magical') {
        const int = getFinalStat(source, 'intelligence');
        damageSelf = Math.floor(damageSelf * (1 + int * 0.04));
    } else if (effect.damageType === 'agile') {
        const agi = getFinalStat(source, 'agility');
        damageSelf = Math.floor(damageSelf * (1 + agi * 0.035));
    }
    
    damageSelf = Math.max(1, damageSelf);
    const actualDamageSelf = applyDamage(target, damageSelf, effect.ignoreArmor || false);
    addLog(`${source.name}消耗了自身${consumedLayersSelf}层【${statusNameSelf}】，对${target.name}造成${actualDamageSelf}点额外伤害！`, 'damage');
    showFloat(target, `-${actualDamageSelf}`, 'damage');
    
    removeStackableLayers(source, statusNameSelf, consumedLayersSelf, effect.removeOldest !== false);
    checkDeath(target);
    break;

case 'self_effect':
    const effectsToApply = effect.nested_effects || effect.effects;
    if (effectsToApply && Array.isArray(effectsToApply)) {
        effectsToApply.forEach(nestedEffect => {
            applyEffect(source, nestedEffect, source);
        });
    } else {
    }
    break;

    case 'restraint_reduce':
      target.restraint = Math.max(0, (target.restraint || 0) - effect.value);
      if (target.restraint <= 0) {
        removeRestraint(target);
      }
      break;

    case 'heal_percent':
      const healAmount = Math.floor(target.hp.max * (effect.value / 100));
      target.hp.current = Math.min(target.hp.max, target.hp.current + healAmount);
      showFloat(target, `+${healAmount}`, 'heal');
      break;

    case 'pleasure_bonus':
      target.pleasure.damageBonus = (target.pleasure.damageBonus || 1.0) + (effect.value / 100);
      break;

    case 'taunt':
      target.isTaunting = true;
      target.buffs.push({
        name: '嘲讽',
        description: '强制敌人攻击自己',
        remainingActions: effect.duration,
        type: 'buff',
        effects: [{ stat: 'taunt', value: 1, duration: effect.duration }]
      });
      break;

    case 'heal': {
      const healAmount = Math.min(effect.value, target.hp.max - target.hp.current);
      target.hp.current += healAmount;
      showFloat(target, `+${healAmount}`, 'heal');
      break;
    }

    case 'mp_restore': {
      const mpAmount = Math.min(effect.value, target.mp.max - target.mp.current);
      target.mp.current += mpAmount;
      showFloat(target, `+${mpAmount}MP`, 'buff');
      break;
    }

    case 'shield': {
  let shieldValue = effect.value || 0;
  let bindTargetId = null;
  
  const isArmorSkill = (effect.source === '肉铠护甲') || (G.selectedSkill && G.selectedSkill.name === '肉铠化');
  
  if (isArmorSkill) {
    shieldValue = Math.floor(source.hp.max * 0.25);
    
    const oppositeSide = source.side === 'player' ? 'enemy' : 'player';
    const targetUnits = oppositeSide === 'player' ? G.playerUnits : G.enemyUnits;
    const boundTarget = targetUnits.find(t => 
      t.debuffs && t.debuffs.some(d => d.name === '肉铠拘束' && d.casterId === source.id)
    );
    if (boundTarget) {
      bindTargetId = boundTarget.id;
    }
    
    const existingArmorIndex = target.ac.findIndex(ac => ac.source === '肉铠护甲');
    if (existingArmorIndex !== -1) {
      break; 
    }
  } else {
    if (effect.bonusCasterHpPercent) {
      shieldValue += Math.floor(source.hp.max * effect.bonusCasterHpPercent);
    }
    if (effect.bonusCasterIntMultiplier) {
      shieldValue += Math.floor(getUnitStat(source, 'matk') * effect.bonusCasterIntMultiplier);
    }
    if (effect.bonusTargetHpPercent) {
      shieldValue += Math.floor(target.hp.max * effect.bonusTargetHpPercent);
    }
    shieldValue = Math.floor(shieldValue);
  }
  
  if (shieldValue <= 0) break;
  
  target.ac.push({
    source: isArmorSkill ? '肉铠护甲' : (effect.source || '护盾'),
    current: shieldValue,
    max: shieldValue,
    remainingTurns: effect.duration || -1,
    addTime: Date.now(),
    bindTargetId: bindTargetId || null
  });
  
  if (shieldValue > 0) {
    addLog(`${target.name} 获得了 ${shieldValue} 点${isArmorSkill ? '肉铠' : ''}护甲`, 'system');
  }
  break;
}

        case 'atk_up_small':
        case 'atk_up_medium':
        case 'atk_up_large':
        case 'atk_up_extreme':
        case 'matk_up_small':
        case 'matk_up_medium':
        case 'matk_up_large':
        case 'matk_up_extreme':
        case 'def_up_small':
        case 'def_up_medium':
        case 'def_up_large':
        case 'def_up_extreme':
        case 'spd_up_small':
        case 'spd_up_medium':
        case 'spd_up_large':
        case 'spd_up_extreme': {
            // 默认值表
            const defaultValues = {
                'atk_up_small': 10, 'atk_up_medium': 30, 'atk_up_large': 50, 'atk_up_extreme': 100,
                'matk_up_small': 10, 'matk_up_medium': 30, 'matk_up_large': 50, 'matk_up_extreme': 100,
                'def_up_small': 10, 'def_up_medium': 30, 'def_up_large': 50, 'def_up_extreme': 100,
                'spd_up_small': 10, 'spd_up_medium': 30, 'spd_up_large': 50, 'spd_up_extreme': 100
            };
            const statNames = {
                'atk_up_small': '物攻', 'atk_up_medium': '物攻', 'atk_up_large': '物攻', 'atk_up_extreme': '物攻',
                'matk_up_small': '魔攻', 'matk_up_medium': '魔攻', 'matk_up_large': '魔攻', 'matk_up_extreme': '魔攻',
                'def_up_small': '防御', 'def_up_medium': '防御', 'def_up_large': '防御', 'def_up_extreme': '防御',
                'spd_up_small': '速度', 'spd_up_medium': '速度', 'spd_up_large': '速度', 'spd_up_extreme': '速度'
            };
            const statKeys = {
                'atk_up_small': 'atk', 'atk_up_medium': 'atk', 'atk_up_large': 'atk', 'atk_up_extreme': 'atk',
                'matk_up_small': 'matk', 'matk_up_medium': 'matk', 'matk_up_large': 'matk', 'matk_up_extreme': 'matk',
                'def_up_small': 'def', 'def_up_medium': 'def', 'def_up_large': 'def', 'def_up_extreme': 'def',
                'spd_up_small': 'spd', 'spd_up_medium': 'spd', 'spd_up_large': 'spd', 'spd_up_extreme': 'spd'
            };
            const rawValue = (effect.value !== undefined) ? effect.value : defaultValues[effect.type];
            const isPercent = Math.abs(rawValue) <= 1 && rawValue !== 0;
            const display = isPercent ? (rawValue * 100).toFixed(0) + '%' : rawValue + ' 点';
            const name = statNames[effect.type] + '上升';
            const stat = statKeys[effect.type];

            target.buffs.push({
                name: name,
                description: `${name}增加 ${display}`,
                duration: effect.duration,
                type: 'buff',
                effects: [{ stat: stat, value: rawValue, duration: effect.duration }]
            });
            break;
        }

        case 'curse': {
            const rawValue = (effect.value !== undefined) ? effect.value : 0.2;
            const isPercent = Math.abs(rawValue) <= 1 && rawValue !== 0;
            const display = isPercent ? (rawValue * 100).toFixed(0) + '%' : rawValue + ' 点';
            const absVal = Math.abs(rawValue);
            target.debuffs.push({
                name: '诅咒',
                description: `物攻、魔攻、防御、速度降低 ${display}`,
                duration: effect.duration,
                type: 'debuff',
                effects: [
                    { stat: 'atk', value: -absVal, duration: effect.duration },
                    { stat: 'matk', value: -absVal, duration: effect.duration },
                    { stat: 'def', value: -absVal, duration: effect.duration },
                    { stat: 'spd', value: -absVal, duration: effect.duration }
                ]
            });
            break;
        }

case 'stun':
    if (hasStatusDuplicate(target, '眩晕')) {
        break;
    }
    target.isStunned = true;
    target.debuffs.push({
        name: '眩晕',
        description: '无法行动',
        duration: effect.duration,  
        type: 'debuff',
        effects: [{ stat: 'stun', value: 1, duration: effect.duration }]
    });
    break;

case 'restraint':
    if (hasStatusDuplicate(target, '拘束')) {
        break;
    }
    const existingRestraint = target.debuffs.find(d => d.name === '拘束');
    if (existingRestraint) {
        break;
    }
    
    target.restraint = 100;
    target.isRestrained = true;
    target._originalSkills = target.skills;
    target._originalLearnedSkills = target.learnedSkills;
    target._originalEquippedSkills = target.equippedSkills;
    target.debuffs.push({
        name: '拘束',
        description: '被拘束，角色无法自由行动',
        duration: -1,  // 改这里
        type: 'debuff',
        effects: [{ stat: 'restraint', value: 1, duration: -1 }]
    });
    break;

    case 'purify': {
      const removed = removeDebuffsByRule(target, d => {
        if (effect.purifyAll) return true;
        const tags = d.tags || [];
        const byTag = Array.isArray(effect.purifyTags) && effect.purifyTags.some(t => tags.includes(t));
        const byName = Array.isArray(effect.purifyNames) && effect.purifyNames.includes(d.name);
        return byTag || byName;
      });
      target.isStunned = false;
      updatePleasureBonus(target);
      addLog(`${target.name}净化了${removed}个负面状态`, 'system');
      break;
    }

case 'lightning_attach': {
    const debuff = addOrStackDebuff(target, '雷电附着', {
        description: '雷电附着，累计后转为麻痹',
        duration: effect.duration || 3,  // 改这里
        refreshDuration: effect.duration || 3,
        effects: [
            { stat: 'burn', value: effect.burnValue ?? 3, duration: effect.duration || 3 },
            { stat: 'pleasure_dot', value: effect.pleasureDotValue ?? 5, duration: effect.duration || 3 }
        ],
        tags: ['debuff', 'lightning']
    });
    debuff.accumulationCount = (debuff.accumulationCount || 0) + 1;
    debuff.transformationThreshold = effect.transformationThreshold || 2;
    addLog(`${target.name}被施加雷电附着（层数: ${debuff.accumulationCount}）`, 'system');
    break;
}

case 'lust_seal_add': {
    const maxStacks = effect.maxStacks || 3;
    const d = addOrStackDebuff(target, '淫纹', {
        description: '淫纹持续强化情欲',
        duration: -1,  // 改这里
        addStack: 1,
        maxStacks,
        stacks: 1,
        tags: ['debuff', 'lust', 'mental']
    });
    addLog(`${target.name}的淫纹层数变为 ${d.stacks}/${maxStacks}`, 'pleasure');
    break;
}

case 'hypnosis_add':
  const isMale = target.gender === 'male' || target.gender === '男' || target.gender === 'm';
  if (isMale && !G.maleHypnosisEnabled) {
    addLog(`${target.name}是男性，催眠值未增加`, 'system');
    break;
  }
  
  const cs = getOrInitConsciousness(target);
  cs.hypnosisValue = Math.min(cs.maxHypnosisValue, (cs.hypnosisValue || 0) + (effect.value || 0));
  addLog(`${target.name}催眠值上升至 ${cs.hypnosisValue}`, 'system');
  applyOrRefreshMentalState(target);
  break;

case 'forced_ovulation':
    if (target.side === 'player') {
        if (!target.pregnancySystem) {
            target.pregnancySystem = {
                isActive: false,
                type: null,
                growth: 0,
                birthingCheckModifier: 0,
                sourceName: null,
                pregnancyForced: false
            };
        }
        target.pregnancySystem.pregnancyForced = true;
        target.debuffs.push({
            name: '强制排卵',
            description: '怀孕概率提升75%',
            duration: effect.duration || 3,
            type: 'debuff',
            effects: [{ stat: 'pregnancy_chance', value: 0.75, duration: effect.duration || 3 }]
        });
        if (target.pleasure) {
            const pleasureIncrease = Math.floor(target.pleasure.max * 0.3);
            target.pleasure.current = Math.min(target.pleasure.max, target.pleasure.current + pleasureIncrease);
            addLog(`${target.name}的身体被强制进入危险期，情欲增加了${pleasureIncrease}点！`, 'pleasure');
        } else {
            addLog(`${target.name}的身体被强制进入危险期！`, 'system');
        }
    }
    break;

    case 'battle_start_aura':
      if (typeof G === 'undefined' || !G.playerUnits) {
        break;
      }
      
      if (!target.battleStartAuras) {
        target.battleStartAuras = [];
      }
      
      const aurasToAdd = Array.isArray(effect.auras) ? effect.auras : [{
        statusName: effect.statusName,
        statusData: effect.statusData,
        duration: effect.duration,
        applyToSelf: effect.applyToSelf,
        applyToAllies: effect.applyToAllies,
        applyToEnemies: effect.applyToEnemies
      }];
      
      aurasToAdd.forEach(aura => {
        target.battleStartAuras.push({
          statusName: aura.statusName,
          statusData: aura.statusData || {},
          duration: aura.duration !== undefined ? aura.duration : (effect.duration || -1),
          applyToSelf: aura.applyToSelf !== undefined ? aura.applyToSelf : (effect.applyToSelf !== false),
          applyToAllies: aura.applyToAllies || effect.applyToAllies || false,
          applyToEnemies: aura.applyToEnemies || effect.applyToEnemies || false,
          sourceName: source?.name || target.name
        });
      });
      
      addLog(`${target.name} 获得了被动效果: ${effect.statusName || '战斗开始光环'}`, 'system');
      break;

case 'custom_debuff': {
    let alreadyAdded = false;   
    if (!effect.name) break;
    
    const stackable = isStackableStatus(effect.name, effect);
    
    if (stackable) {
        const statusType = effect.statusType || 'debuff';
        const config = {
            ...effect,
            type: statusType,
            displayName: effect.displayName || effect.name,
            layers: effect.layers || 1,
            duration: effect.duration || 3,
            maxLayers: effect.maxLayers || 10,
            effects: effect.effects || [],
            thresholdEffects: effect.thresholdEffects || [],
            customLogs: effect.customLogs || [],
            decayOnAttack: effect.decayOnAttack || false
        };
        addStackableStatus(target, effect.name, config, source, true);
        alreadyAdded = true;   
    } else {
        const processedEffects = (effect.effects || []).map(e => {
            const newEffect = { ...e };
            if (newEffect.duration === undefined && effect.duration !== undefined) {
                newEffect.duration = effect.duration;
            }
            return newEffect;
        });
        const targetArray = effect.type === 'buff' ? target.buffs : target.debuffs;
        if (!targetArray) {
            if (effect.type === 'buff') target.buffs = [];
            else target.debuffs = [];
        }
        const newStatus = {
            name: effect.name,
            description: effect.description || '',
            duration: effect.duration ?? 1,
            type: effect.type === 'buff' ? 'buff' : 'debuff',
            stackable: false,
            effects: processedEffects,
            customLogs: effect.customLogs || [],
            decayOnAttack: effect.decayOnAttack || false,
            onAttackEffects: effect.onAttackEffects || [],
            consumeOnAttack: effect.consumeOnAttack || false,
            sourceName: source?.name || null,
            sourceSide: source?.side || null
        };
        if (effect.name === '肉铠拘束') {
            newStatus.isArmorRestraint = true;
            newStatus.armorRestraint = effect.extra?.armorRestraint || 100;
            newStatus.casterId = source.id;
        }
        (effect.type === 'buff' ? target.buffs : target.debuffs).push(newStatus);
        alreadyAdded = true;   
    }
    
    const sourceName = source?.name || '未知';
    const targetName = target.name;
    const effectName = effect.name;
    
    if (window._currentSkillInProgress && !effect._suppressLog) {
        if (!target._pendingStatuses) target._pendingStatuses = [];
        if (!target._pendingStatuses.includes(effect.name)) {
            target._pendingStatuses.push(effect.name);
        }
    } else {
        if (source === target) {
            addLog(`${sourceName}赋予了自身【${effectName}】状态`, 'system');
        } else {
            addLog(`${sourceName}赋予了${targetName}【${effectName}】状态`, 'system');
        }
    }
    
    if (hasStatusDuplicate(target, effect.name)) {
        break;
    }
    
    const isParasiteAttempt = 
        effect.name === '寄生尝试' ||
        effect.name === '寄生' ||
        effect.name === 'infest' ||
        effect.name === 'parasite' ||
        (effect.name && effect.name.includes('寄生'));
    
    if (isParasiteAttempt) {
        const isMale = target.gender === 'male' || target.gender === '男' || target.gender === 'm';
        if (isMale && !G.maleParasiteEnabled) {
            addLog(`${target.name}是男性，寄生失败`, 'system');
            break;
        }
        setGestation(target, 'parasite', source?.name);
        break;
    }
    
    const isPregnancyAttempt = 
        effect.name === '怀孕尝试' ||
        effect.name === '怀孕' ||
        effect.name === 'impregnate' ||
        effect.name === 'pregnancy' ||
        (effect.name && effect.name.includes('怀孕'));
    
    if (isPregnancyAttempt) {
        const isFemale = target.gender === 'female' || target.gender === '女' || target.gender === '♀';
        const isMale = target.gender === 'male' || target.gender === '男' || target.gender === 'm';
        
        if (isMale && !G.malePregnancyEnabled) {
            addLog(`${target.name}是男性，无法怀孕`, 'system');
            break;
        }
        
        if (!isFemale) {
            if (!isMale || (isMale && !G.malePregnancyEnabled)) {
                break;
            }
        }
        
        if (target.side === 'player' && !target.pregnancySystem?.isActive) {
            if (!target.pregnancySystem) {
                target.pregnancySystem = {
                    isActive: false,
                    type: null,
                    growth: 0,
                    birthingCheckModifier: 0,
                    sourceName: null,
                    pregnancyForced: false
                };
            }
            
            let pregnancyChance = 0.05;
            const isDangerTurn = (G.turn % 4 === 0);
            if (isDangerTurn) pregnancyChance = 0.75;
            const hasForcedOvulation = target.debuffs.some(d => d.name === '强制排卵');
            if (hasForcedOvulation) pregnancyChance = Math.min(1, pregnancyChance + 0.75);
            
            const roll = Math.floor(Math.random() * 100) + 1;
            const chancePercent = pregnancyChance * 100;
            addLog(`${target.name} 怀孕判定: 需要≤${chancePercent.toFixed(0)}%，Roll点: ${roll}`, 'system');
            
            if (roll <= chancePercent) {
                setGestation(target, 'pregnancy', source?.name);
            } else {
                addLog(`${target.name} 没有怀孕`, 'system');
            }
        }
        break;
    }
    
    if (!alreadyAdded) {
        const def = window.getStatusDefinition ? (window.getStatusDefinition(effect.name) || {}) : {};
        const statusEffects = effect.effects || def.effects || [];
        const actionLogs = effect.actionLogs || effect.customLogs || def.actionLogs || def.customLogs || [];
        const stateDuration = effect.duration ?? def.duration ?? 1;
        const processedEffects = statusEffects.map(e => {
            const newEffect = { ...e };
            if (newEffect.duration === undefined && stateDuration !== undefined) {
                newEffect.duration = stateDuration;
            }
            return newEffect;
        });
        
        let armorRestraintValue = 100;
        let casterId = null;
        if (effect.name === '肉铠拘束') {
            armorRestraintValue = effect.extra?.armorRestraint || 100;
            casterId = source.id;
        }
        
        const targetArray = effect.type === 'buff' ? target.buffs : target.debuffs;
        if (!targetArray) {
            if (effect.type === 'buff') target.buffs = [];
            else target.debuffs = [];
        }
        (effect.type === 'buff' ? target.buffs : target.debuffs).push({
            name: effect.name,
            description: effect.description || def.description || '',
            duration: stateDuration,
            type: effect.type === 'buff' ? 'buff' : 'debuff',
            stackable: false,
            effects: processedEffects,
            isArmorRestraint: effect.name === '肉铠拘束',
            armorRestraint: armorRestraintValue,
            casterId: casterId,
            actionLogs: actionLogs,
            customLogs: actionLogs,
            sourceName: source?.name || null,
            sourceSide: source?.side || null
        });
        
        if (statusEffects.some(e => e.stat === 'pleasure_damage_taken')) {
            updatePleasureBonus(target);
        }
    }
    break;
}

case 'summon':
  summonUnit(source, effect.customConfig || null);
  break;

case 'pleasure_dot':
    target.debuffs.push({
        name: '情欲侵蚀',
        description: `每次行动受到${effect.value}点情欲伤害`,
        duration: effect.duration,  
        type: 'debuff',
        effects: [{ stat: 'pleasure_dot', value: effect.value, duration: effect.duration }]
    });
    break;
  }
}

function updatePleasureBonus(unit) {
  let bonus = 0;
  unit.buffs.forEach(buff => {
    buff.effects.forEach(effect => {
      if (effect.stat === 'pleasure_damage_taken') bonus += effect.value;
    });
  });
  unit.debuffs.forEach(debuff => {
    debuff.effects.forEach(effect => {
      if (effect.stat === 'pleasure_damage_taken') bonus += effect.value;
    });
  });
  unit.pleasure.damageBonus = bonus + 1.0;
}

function applyBattleStartAuras(unit) {
  if (!unit.battleStartAuras || unit.battleStartAuras.length === 0) return;
  
  addLog(`${unit.name} 的战斗开始效果触发`, 'system');
  
  unit.battleStartAuras.forEach(aura => {
    let targets = [];
    
    if (aura.applyToSelf) targets.push(unit);
    if (aura.applyToAllies) {
      const allies = unit.side === 'player' ? G.playerUnits : G.enemyUnits;
      allies.forEach(ally => {
        if (ally !== unit && ally.hp.current > 0) targets.push(ally);
      });
    }
    if (aura.applyToEnemies) {
      const enemies = unit.side === 'player' ? G.enemyUnits : G.playerUnits;
      enemies.forEach(enemy => {
        if (enemy.hp.current > 0) targets.push(enemy);
      });
    }
    if (targets.length === 0) targets = [unit];
    
    targets.forEach(target => {
      // 确保 duration 正确传递
      const statusDuration = aura.duration ?? -1;
      
      const statusEffect = {
        name: aura.statusName,
        description: aura.statusData.description || `来自${unit.name}的${aura.statusName}`,
        duration: statusDuration,  // ✅ 使用 -1
        type: aura.statusData.type || 'buff',
        effects: (aura.statusData.effects || []).map(e => ({
          ...e,
          duration: e.duration ?? statusDuration  // 内部 effect 也继承相同 duration
        })),
        sourceName: unit.name,
        sourceSide: unit.side
      };
      
      if (statusEffect.type === 'buff') {
        target.buffs.push(statusEffect);
        addLog(`${target.name}获得了来自${unit.name}的${aura.statusName}（战斗开始）`, 'system');
      } else {
        target.debuffs.push(statusEffect);
        addLog(`${target.name}受到了来自${unit.name}的${aura.statusName}（战斗开始）`, 'system');
      }
    });
  });
  
  updateHPMPOnStatChange(unit);
  updatePleasureBonus(unit);
}

function summonUnit(summoner, config = null) {
  // 容量检查
  if (summoner.side === 'player' && G.playerUnits.length >= 6) {
    addLog('我方单位已满，无法召唤', 'system');
    return null;
  }
  if (summoner.side === 'enemy' && G.enemyUnits.length >= 4) {
    addLog('敌方单位已满，无法召唤', 'system');
    return null;
  }

  // 如果 config 存在，使用自定义配置；否则使用默认硬编码
  const template = config || {};

  // 合并默认值与自定义值
  const summonName = template.name || `${summoner.name}的魔像`;
  const gender = template.gender || 'male';
  const battleLevel = template.battleLevel !== undefined ? template.battleLevel : Math.floor(summoner.battleLevel * 0.7);
  const hpMax = (template.hp && template.hp.max) || 50;
  const mpMax = (template.mp && template.mp.max) || 10;
  const baseAtk = (template.atk && template.atk.base) || 10;
  const pleasureMax = (template.pleasure && template.pleasure.max) || 50;
  const stats = template.stats || { constitution: 5, intelligence: 5, agility: 5 };
  const portraitUrl = template.portraitUrl || null;
  const clothingIntegrity = template.clothingIntegrity !== undefined ? template.clothingIntegrity : 100;

  // 技能解析（如果传入字符串技能名，尝试从世界书加载）
  let skills = template.skills || [{
    name: '撞击', type: 'skill', targetType: 'single_enemy', actionType: ACTION_TYPE.ATTACK,
    damageType: 'physical', cost: { hp: 0, mp: 0 }, multiplier: 0.8,
    effects: [], description: '基础攻击', ignoreArmor: false, 
    pleasurePercent: 0, pleasureAttrMultiplier: 0
  }];
  if (worldbookData.skills) {
    skills = skills.map(skill => {
      if (typeof skill === 'string') {
        return getSkillFromWorldbook(skill) || { name: skill, requiredLevel: 0 };
      }
      return skill;
    }).filter(s => s !== null);
  }

  const learnedSkills = template.learnedSkills || skills;
  const equippedSkills = template.equippedSkills || [];

  const summon = {
    id: `summon_${Date.now()}_${Math.random()}`,
    name: summonName,
    gender: gender,
    isBoss: false,
    battleLevel: battleLevel,
    hp: { current: hpMax, max: hpMax },
    mp: { current: mpMax, max: mpMax },
    atk: { base: baseAtk },
    pleasure: { current: 0, max: pleasureMax, damageBonus: 0 },
    ac: template.ac || [],
    skills: skills,
    buffs: template.buffs || [],
    debuffs: template.debuffs || [],
    isStunned: false,
    isTaunting: false,
    isSummoned: true,
    side: summoner.side,
    stats: stats,
    freeAttributePoints: 0,
    learnedSkills: learnedSkills,
    equippedSkills: equippedSkills,
    actionDistance: 0,
    nextActionPoint: 0,
    portraitUrl: portraitUrl,
    clothingIntegrity: clothingIntegrity,
    skillCooldowns: {},
    ...(template.isBoss !== undefined && { isBoss: template.isBoss }),
    ...(template.ac && { ac: template.ac }),
    ...(template.buffs && { buffs: template.buffs }),
    ...(template.debuffs && { debuffs: template.debuffs })
  };

  const tempUnit = { ...summon, buffs: [], debuffs: [] };
  summon.hp.max = calculateMaxHP(tempUnit);
  summon.hp.current = summon.hp.max;
  summon.mp.max = calculateMaxMP(tempUnit);
  summon.mp.current = summon.mp.max;

  if (summoner.side === 'player') G.playerUnits.push(summon);
  else G.enemyUnits.push(summon);

  addLog(`${summoner.name}召唤了${summon.name}`, 'system');
  updateUI();
  recalculateActionOrder();
  return summon;
}

function maybeCorruptSkillByHypnosis(unit, skill) {
    if (!unit || !skill) return skill;
    
    const isMale = unit.gender === 'male' || unit.gender === '男' || unit.gender === 'm';
    if (isMale && !G.maleHypnosisEnabled) {
        return skill;
    }
    
    const cs = getOrInitConsciousness(unit);
    if (!cs) return skill;
    
    if (cs.currentState === 'commonSense') {
        const allErosionSkills = EROSION_SKILLS.map(s => buildErosionSkillObject({ ...s, unlocked: true }));
        if (allErosionSkills.length > 0) {
            const newSkill = allErosionSkills[Math.floor(Math.random() * allErosionSkills.length)];
            addLog(`🌀 ${unit.name}处于常识篡改状态，【${skill.name}】被替换为【${newSkill.name}】`, 'system');
            return newSkill;
        }
        return skill;
    }
    
    if (cs.currentState === 'bodyControl') {
        const hypnosisExcess = (cs.hypnosisValue || 0) - (cs.awarenessValue || 25);
        if (hypnosisExcess <= 0) return skill;
        
        // 概率公式：超出值 × 2%，最大80%
        const corruptionProb = Math.min(0.8, hypnosisExcess * 0.02);
        
        if (Math.random() < corruptionProb) {
            const allErosionSkills = EROSION_SKILLS.map(s => buildErosionSkillObject({ ...s, unlocked: true }));
            if (allErosionSkills.length > 0) {
                const newSkill = allErosionSkills[Math.floor(Math.random() * allErosionSkills.length)];
                addLog(`🌀 ${unit.name}处于身体操作状态，【${skill.name}】被替换为【${newSkill.name}】`, 'system');
                return newSkill;
            }
        }
    }
    
    return skill;
}

function processAttackDecayStatuses(unit) {
    if (unit.buffs) {
        for (let i = unit.buffs.length-1; i >= 0; i--) {
            const buff = unit.buffs[i];
            if (buff.decayOnAttack === true) {
                if (buff.stackable === true) {
                    removeStackableLayers(unit, buff.name, 1, true);
                } else {
                    if (buff.duration !== undefined && buff.duration !== -1) {
                        buff.duration--;
                        if (buff.duration <= 0) {
                            unit.buffs.splice(i,1);
                            addLog(`${unit.name}的${buff.displayName || buff.name}效果消失了`, 'system');
                        } else {
                            addLog(`${unit.name}的${buff.displayName || buff.name}剩余次数: ${buff.duration}`, 'system');
                        }
                    } else {
                        unit.buffs.splice(i,1);
                        addLog(`${unit.name}的${buff.displayName || buff.name}效果已消耗`, 'system');
                    }
                }
            }
        }
    }
    if (unit.debuffs) {
        for (let i = unit.debuffs.length-1; i >= 0; i--) {
            const debuff = unit.debuffs[i];
            if (debuff.decayOnAttack === true) {
                if (debuff.stackable === true) {
                    removeStackableLayers(unit, debuff.name, 1, true);
                } else {
                    if (debuff.duration !== undefined && debuff.duration !== -1) {
                        debuff.duration--;
                        if (debuff.duration <= 0) {
                            unit.debuffs.splice(i,1);
                            addLog(`${unit.name}的${debuff.displayName || debuff.name}效果消失了`, 'system');
                        } else {
                            addLog(`${unit.name}的${debuff.displayName || debuff.name}剩余次数: ${debuff.duration}`, 'system');
                        }
                    } else {
                        unit.debuffs.splice(i,1);
                        addLog(`${unit.name}的${debuff.displayName || debuff.name}效果已消耗`, 'system');
                    }
                }
            }
        }
    }
}

function processSpecialEnergyTrigger(attacker, skill) {
    if (!skill || !skill.specialEnergyTrigger) return;
    const triggers = Array.isArray(skill.specialEnergyTrigger) 
        ? skill.specialEnergyTrigger 
        : [skill.specialEnergyTrigger];
    
    const allies = attacker.side === 'player' ? G.playerUnits : G.enemyUnits;
    const targets = allies.filter(u => u.id !== attacker.id && u.hp.current > 0);
    if (targets.length === 0) return;

    triggers.forEach(trigger => {
        const type = trigger.type;
        const amount = trigger.amount || 0;
        if (!type || amount <= 0) return;
        targets.forEach(target => {
            if (target.specialEnergy && target.specialEnergy[type]) {
                const oldVal = target.specialEnergy[type].current;
                const maxVal = target.specialEnergy[type].max || 100;
                target.specialEnergy[type].current = Math.min(maxVal, oldVal + amount);
                const added = target.specialEnergy[type].current - oldVal;
                if (added > 0) {
                    addLog(`${target.name} 因 ${attacker.name} 使用【${skill.name}】获得 ${added} 点 ${type} 能量`, 'system');
                }
            }
        });
    });
}

function isConditionMet(condition, attacker, defender) {
    if (!condition) return true;
    if (condition.targetHasStatus) {
        const statusName = condition.targetHasStatus;
        const has = [...(defender.buffs || []), ...(defender.debuffs || [])].some(s => s.name === statusName);
        if (!has) return false;
    }
    return true;
}

function triggerOnAttackEffects(attacker, defender, skill) {
    if (skill.actionType !== ACTION_TYPE.ATTACK) return;
    
    const allStatuses = [...(attacker.buffs || []), ...(attacker.debuffs || [])];
    
    for (const status of allStatuses) {
        if (status.onAttackEffects && status.onAttackEffects.length > 0) {
            let shouldConsume = status.consumeOnAttack === true;
            let appliedAny = false;
            
            for (const effect of status.onAttackEffects) {
                if (!isConditionMet(effect.condition, attacker, defender)) {
                    continue;
                }
                appliedAny = true;
                let target = defender;
                if (effect.target === 'self') target = attacker;
                applyEffect(target, effect, attacker);
            }
            
            if (appliedAny) {
                const defaultMsg = `${attacker.name}的${status.displayName || status.name}效果触发！`;
                let customMsg = '';
                if (status.customLogs && status.customLogs.length > 0) {
                    const randomLog = getRandomFromArray(status.customLogs);
                    if (randomLog) {
                        customMsg = ' ' + formatBattleText(randomLog, { attacker, defender });
                    }
                }
                addLog(defaultMsg + customMsg, 'system');
            }
            
            if (shouldConsume) {
                if (status.stackable === true) {
                    removeStackableLayers(attacker, status.name, 1, true);
                }
            }
        }
    }
}

function triggerConditionalEffects(attacker, defender, skill, actualDamageDealt, totalDamageDealt) {
    if (!skill.conditionalEffects) return;
    
    for (const cond of skill.conditionalEffects) {
        let conditionMet = false;
        
        // self 状态
        if (cond.self) {
            for (const req of cond.self) {
                const status = findStatus(attacker, req.statusName);
                const currentLayers = status?.totalLayers || 0;
                if (currentLayers >= (req.minLayers || 1)) {
                    conditionMet = true;
                    break;
                }
            }
        }
        
        // target 状态
        if (!conditionMet && cond.target) {
            for (const req of cond.target) {
                const status = findStatus(defender, req.statusName);
                const currentLayers = status?.totalLayers || 0;
                if (currentLayers >= (req.minLayers || 1)) {
                    conditionMet = true;
                    break;
                }
            }
        }
        
        // 伤害阈值
        if (!conditionMet && cond.damageThreshold) {
            if (actualDamageDealt >= (cond.damageThreshold.min || 0) &&
                (cond.damageThreshold.max === undefined || actualDamageDealt <= cond.damageThreshold.max)) {
                conditionMet = true;
            }
        }
        
        // === 施法者特殊能量 ===
        if (!conditionMet && cond.selfSpecialEnergy) {
            const req = cond.selfSpecialEnergy;
            const energy = attacker.specialEnergy?.[req.typeName]?.current || 0;
            let met = true;
            if (req.min !== undefined && energy < req.min) met = false;
            if (req.max !== undefined && energy > req.max) met = false;
            if (met) conditionMet = true;
        }
        
        // === 目标特殊能量 ===
        if (!conditionMet && cond.targetSpecialEnergy) {
            const req = cond.targetSpecialEnergy;
            const energy = defender.specialEnergy?.[req.typeName]?.current || 0;
            let met = true;
            if (req.min !== undefined && energy < req.min) met = false;
            if (req.max !== undefined && energy > req.max) met = false;
            if (met) conditionMet = true;
        }
        
        if (conditionMet && cond.effects) {
            cond.effects.forEach(effect => {
                applyEffect(defender, effect, attacker);
            });
            if (cond.logMessage) {
                let logMsg = cond.logMessage
                    .replace(/\{attacker\}/g, attacker.name)
                    .replace(/\{target\}/g, defender.name);
                addLog(logMsg, 'system');
            }
        }
    }
}

function executeAttack(attacker, defender, skill, skipMainLog = false, options = {}) {
    if (typeof skipMainLog === 'object') {
        options = skipMainLog;
        skipMainLog = false;
    }
    // 处理特殊能量触发
    if (!options.skipTrigger) {
        processSpecialEnergyTrigger(attacker, skill);
    }
  if (!skill) return false;
  if (!defender || defender.hp.current <= 0) return false;
  if (skill.requirements?.target && !canUseSkillOnTarget(attacker, defender, skill)) {
    addLog(`${defender.name}不满足技能【${skill.name}】的目标条件，无法使用`, 'system');
    return false;
  }

  // 获取自定义日志
  const customLog = getRandomCustomLog(skill, attacker, defender);

  // ---- 1. 输出技能使用主日志 ----
  if (!skipMainLog) {
    const targetName = skill.targetType === 'self' ? '自身' : defender.name;
    const skillName = skill.isBasicAttack ? '普通攻击' : skill.name;
    addLog(`${attacker.name} 对 ${targetName} 使用了 【${skillName}】`, 'system');

    // ---- 2. 输出自定义日志 ----
    if (customLog) {
      addLog(customLog, 'system');
    }
  }

  // ---- 命中判定 ----
  const hit = checkSkillHit(attacker, defender, skill);
  if (!hit) {
    const missCost = getBaseActionCost(attacker);
    attacker.remainingAP -= missCost;
    if (G.actionQueue.length > 0 && G.actionQueue[0] === attacker) G.actionQueue.shift();
    G.processedUnits.add(attacker.id);
    addLog(`${defender.name} 回避了 ${attacker.name} 的攻击！`, 'system');
    postActionSettlement(attacker);
    recalculateActionOrder();
    return false;
  }

  // ---- 资源消耗（命中后执行） ----
  let actualCost = calculateActionCost(attacker, skill);
  if (skill.isBasicAttack) {
    actualCost = getBaseActionCost(attacker);
  }

  // 消耗 AC
  if (skill.cost?.ac && skill.cost.ac > 0 && attacker.ac && attacker.ac.length > 0) {
    let remainingCost = skill.cost.ac;
    const sortedAC = [...attacker.ac].sort((a, b) => (a.addTime || 0) - (b.addTime || 0));
    for (let i = 0; i < sortedAC.length && remainingCost > 0; i++) {
      const ac = sortedAC[i];
      const actualIdx = attacker.ac.indexOf(ac);
      if (actualIdx === -1) continue;
      const absorbed = Math.min(remainingCost, ac.current);
      ac.current -= absorbed;
      remainingCost -= absorbed;
      if (ac.current <= 0) {
        attacker.ac.splice(actualIdx, 1);
        addLog(`${ac.source}被消耗了！`, 'system');
      }
    }
  }

  // 消耗情欲值（正值为增加，负值为减少）
  if (skill.cost?.pleasure !== undefined && skill.cost.pleasure !== 0) {
    const pleasureChange = skill.cost.pleasure;
    if (pleasureChange > 0) {
      const triggeredOrgasm = addPleasure(attacker, pleasureChange, attacker.name, skill.name, skill.targetType === 'self');
      if (triggeredOrgasm) {
        updateUI();
        processPendingOrgasm(attacker, attacker.name, skill.name);
      }
    } else if (pleasureChange < 0) {
      const reductionAmount = Math.min(Math.abs(pleasureChange), attacker.pleasure.current);
      attacker.pleasure.current = Math.max(0, attacker.pleasure.current - reductionAmount);
    }
  }

  // 消耗特殊能量
  if (skill.cost?.specialEnergy) {
    for (let type in skill.cost.specialEnergy) {
      const amount = skill.cost.specialEnergy[type];
      if (!attacker.specialEnergy) attacker.specialEnergy = {};
      if (!attacker.specialEnergy[type]) {
        attacker.specialEnergy[type] = { current: 0, max: 100 };
      }
      attacker.specialEnergy[type].current = Math.max(0, attacker.specialEnergy[type].current - amount);
    }
  }

  // ---- 技能效果执行 ----
  // 非攻击技能
  if (skill.actionType === ACTION_TYPE.NON_ATTACK) {
    // 执行效果
    skill.effects.forEach(effect => applyEffect(defender, effect, attacker));
    // 消耗 MP/HP
    attacker.mp.current = Math.max(0, attacker.mp.current - (skill.cost?.mp || 0));
    attacker.hp.current = Math.max(0, attacker.hp.current - (skill.cost?.hp || 0));
    G.selectedSkill = null;
    setSkillCooldown(attacker, skill);

// ===== 额外行动处理 =====
if (attacker._extraActionPending && attacker.hp.current > 0) {
  attacker._extraActionPending = false;
  if (attacker.side === 'player') {
    setTimeout(() => {
      G.currentActingUnit = attacker;
      showSkillModal(attacker);
    }, 50);
  } else {
    setTimeout(() => {
      if (attacker.hp.current > 0 && !attacker.isStunned) {
        enemyAI(attacker);
      }
    }, 50);
  }
  return false; 
}

    // 行动消耗（AP）
    attacker.remainingAP -= actualCost;
    const canActAgain = (attacker.hp.current > 0 && !attacker.isStunned && attacker.remainingAP >= getBaseActionCost(attacker));
    if (!canActAgain) {
      if (G.actionQueue.length > 0 && G.actionQueue[0] === attacker) G.actionQueue.shift();
      G.processedUnits.add(attacker.id);
    }
    recalculateActionOrder();
    return false;
  }

  // ---- 攻击技能（包含普通攻击） ----
  // 计算伤害
  const { hpChange, pleasureChange } = calculateSkillEffects(attacker, defender, skill);
  let actualDamageDealt = 0;
  let targetDied = false;

  // HP 伤害/治疗
  if (hpChange !== 0) {
    if (hpChange > 0) {
      const actualDamage = applyDamage(defender, hpChange, skill.ignoreArmor);
      actualDamageDealt = actualDamage;
      addLog(`${defender.name} 受到 ${actualDamage} 点伤害`, 'damage');
      showFloat(defender, `-${actualDamage}`, 'damage');
      targetDied = checkDeath(defender);
    } else {
      const healAmount = Math.min(-hpChange, defender.hp.max - defender.hp.current);
      defender.hp.current += healAmount;
      addLog(`${defender.name} 恢复了 ${healAmount} 点生命`, 'heal');
      showFloat(defender, `+${healAmount}`, 'heal');
    }
  }

  // 情欲伤害
  if (pleasureChange !== 0) {
    if (pleasureChange > 0) {
      const triggeredOrgasm = addPleasure(defender, pleasureChange, attacker.name, skill.name, false);
      if (triggeredOrgasm) {
        updateUI();
        processPendingOrgasm(defender, attacker.name, skill.name);
      }
    } else {
      const reduceAmount = Math.min(-pleasureChange, defender.pleasure.current);
      defender.pleasure.current -= reduceAmount;
      addLog(`${defender.name} 情欲值减少了 ${reduceAmount} 点`, 'pleasure');
      showFloat(defender, `-${reduceAmount}`, 'pleasure');
    }
  }

  // 触发技能附加效果（包括自定义效果）
  if (skill.effects && skill.effects.length) {
    skill.effects.forEach(effect => {
      const skipTypes = ['heal_by_damage', 'restore_mp_by_damage', 'restore_ac_by_damage', 'restore_pleasure_by_damage'];
      if (skipTypes.includes(effect.type)) return;
      if (effect.type === 'self_effect') {
        applyEffect(attacker, effect, attacker);
      } else {
        applyEffect(defender, effect, attacker);
      }
    });
  }

  // 触发反击
  if (skill.actionType === ACTION_TYPE.ATTACK && defender && defender.hp.current > 0 && attacker.hp.current > 0) {
    triggerCounter(defender, attacker, skill);
  }

  // 触发攻击附魔效果（状态触发）
  triggerOnAttackEffects(attacker, defender, skill);

  // 消耗 MP/HP
  attacker.mp.current = Math.max(0, attacker.mp.current - (skill.cost?.mp || 0));
  attacker.hp.current = Math.max(0, attacker.hp.current - (skill.cost?.hp || 0));

  G.selectedSkill = null;
  setSkillCooldown(attacker, skill);

  if (attacker._extraActionPending && attacker.hp.current > 0) {
    attacker._extraActionPending = false;
    if (attacker.side === 'player') {
      setTimeout(() => {
        G.currentActingUnit = attacker;
        showSkillModal(attacker);
      }, 50);
    } else {
      setTimeout(() => {
        if (attacker.hp.current > 0 && !attacker.isStunned) {
          enemyAI(attacker);
        }
      }, 50);
    }
    return false;
  }

  // 显示技能图片
  if (skill.imageUrl) showSkillImageModal(skill.imageUrl, skill.name);
  // 行动消耗
  attacker.remainingAP -= actualCost;
  const canActAgain = (attacker.hp.current > 0 && !attacker.isStunned && attacker.remainingAP >= getBaseActionCost(attacker));
  if (!canActAgain) {
    if (G.actionQueue.length > 0 && G.actionQueue[0] === attacker) G.actionQueue.shift();
    G.processedUnits.add(attacker.id);
  }
  recalculateActionOrder();

  return targetDied;
}

function executeAOESkill(attacker, skill) {
  if (!skill) return;

  const targetType = skill.targetType === 'all_enemies' ? '全体敌人' : '全体友方';
  const skillName = skill.isBasicAttack ? '普通攻击' : skill.name;
  addLog(`${attacker.name} 对 ${targetType} 使用了 【${skillName}】`, 'system');

  const customLog = getRandomCustomLog(skill, attacker);
  if (customLog) {
    addLog(customLog, 'system');
  }

  // 获取目标列表
  let targets = getValidTargets(attacker, skill);
  if (targets.length === 0) {
    addLog(`${attacker.name} 的【${skill.name}】没有目标`, 'system');
    return;
  }

  // 对每个目标执行攻击
    targets.forEach(target => {
        if (target.hp.current > 0) {
            executeAttack(attacker, target, skill, true, { skipTrigger: true });
        }
    });
    processSpecialEnergyTrigger(attacker, skill);
}

function getSkillFromWorldbook(skillName) {
  try {
    let skills = worldbookData.skills;
    if (!skills) {
      console.warn(`技能模板尚未加载，无法查找 "${skillName}"`);
      return null;
    }
    if (!Array.isArray(skills) && typeof skills === 'object') {
      if (skills[skillName]) return skills[skillName];  // 直接返回，不再转换
      skills = skills.skills || skills.skillTemplates || skills['技能模板'] || skills['技能列表'] || skills['skills'] || Object.values(skills);
    }
    if (Array.isArray(skills)) {
      const skill = skills.find(s => {
        const name = String(s?.name || '').trim();
        return name === String(skillName).trim();
      });
      if (skill) return skill;  
    }
    console.warn(`技能 "${skillName}" 未在世界书"技能模板"中找到`);
    return null;
  } catch (error) {
    console.error(`获取技能 "${skillName}" 失败:`, error);
    return null;
  }
}

function getSkillCooldownKey(skill) {
  return skill.cooldownKey || skill.id || skill.name;
}

function getSkillCooldown(unit, skill) {
  if (!unit || !skill) return 0;
  const key = getSkillCooldownKey(skill);
  return Math.max(0, unit.skillCooldowns?.[key] || 0);
}

function setSkillCooldown(unit, skill) {
  if (!unit || !skill || !skill.cooldown) return;

  const cd = Number(skill.cooldown) || 0;
  if (cd <= 0) return;

  if (!unit.skillCooldowns) unit.skillCooldowns = {};
  const key = getSkillCooldownKey(skill);

  unit.skillCooldowns[key] = cd;
}

function tickSkillCooldowns() {
  [...G.playerUnits, ...G.enemyUnits].forEach(unit => {
    if (!unit.skillCooldowns) return;

    Object.keys(unit.skillCooldowns).forEach(key => {
      unit.skillCooldowns[key]--;

      if (unit.skillCooldowns[key] <= 0) {
        delete unit.skillCooldowns[key];
        addLog(`${unit.name}的【${key}】冷却结束`, 'system');
      }
    });
  });
}
    
function canUseSkill(unit, skill) {
    if (!skill || !unit) return false;
    
    if (G.globalCooldowns && G.globalCooldowns[skill.name] > 0) {
        return false;
    }
    
    if (skill.type === 'fusion') return true;
    
    const requiredLevel = skill.requiredLevel || 0;
    if (unit.battleLevel < requiredLevel) return false;
    
    if (skill.cost?.hp > 0 && unit.hp.current <= skill.cost.hp) return false;
    if (skill.cost?.mp > 0 && unit.mp.current < skill.cost.mp) return false;
    if (skill.cost?.ac > 0) {
        const totalAC = unit.ac.reduce((sum, ac) => sum + ac.current, 0);
        if (totalAC < skill.cost.ac) return false;
    }
    if (skill.cost?.pleasure !== undefined && skill.cost.pleasure < 0) {
        if (unit.pleasure.current < Math.abs(skill.cost.pleasure)) return false;
    }
   if (skill.cost && skill.cost.specialEnergy) {
    for (let type in skill.cost.specialEnergy) {
        const needed = skill.cost.specialEnergy[type];
        const current = unit.specialEnergy?.[type]?.current || 0;
        if (current < needed) {
            return false;
        }
    }
}
    if (getSkillCooldown(unit, skill) > 0) {
  return false;
}

    if (skill.requirements) {
        if (skill.requirements.self) {
            for (const req of skill.requirements.self) {
                const status = findStatus(unit, req.statusName);
                const currentLayers = status?.totalLayers || 0;
                if (currentLayers < (req.minLayers || 1)) {
                    return false;
                }
            }
        }
    }
    
    return true;
}

function canUseSkillOnTarget(attacker, defender, skill) {
    if (!skill.requirements?.target) return true;
    
    for (const req of skill.requirements.target) {
        const status = findStatus(defender, req.statusName);
        if (!status) {
            addLog(`${defender.name}身上没有【${req.statusName}】状态，无法使用技能`, 'system');
            return false;
        }
        
        const currentLayers = status.stackable ? (status.totalLayers || 0) : 1;
        const minLayers = req.minLayers || 1;
        
        if (currentLayers < minLayers) {
            addLog(`${defender.name}的【${req.statusName}】层数为 ${currentLayers}，需要至少 ${minLayers} 层`, 'system');
            return false;
        }
    }
    return true;
}

function canLearnSkill(unit, skill) {
  if (!skill || !unit) return false;
  return true;
}

function getSkillRequiredLevel(skill) {
  return skill.requiredLevel || 0;
}

function enemyAI(enemy) {
  if (enemy.isStunned || enemy.hp.current <= 0) return;
  
  let skillSource = enemy.equippedSkills && enemy.equippedSkills.length > 0 
    ? enemy.equippedSkills 
    : (enemy.learnedSkills && enemy.learnedSkills.length > 0 
        ? enemy.learnedSkills 
        : enemy.skills);
  const armorRestraint = enemy.debuffs.find(d => d.name === '肉铠拘束');
  if (armorRestraint) {
    skillSource = [
      { name: '挣扎', type: 'armor_struggle', targetType: 'self', actionType: 'non_attack', effects: [{ type: 'struggle_hp_loss' }, { type: 'armor_restraint_reduce', value: 50 }] },
      { name: '忍耐', type: 'armor_endure', targetType: 'self', actionType: 'non_attack', effects: [{ type: 'heal_percent', value: 10 }, { type: 'pleasure_current_decrease', value: 20 }] },
      { name: '沉溺', type: 'armor_indulge', targetType: 'self', actionType: 'non_attack', effects: [{ type: 'pleasure_current_increase', value: 25 }] }
    ];
  }
  
  if (skillSource && skillSource.length > 0 && typeof skillSource[0] === 'string') {
    const resolvedSkills = [];
    for (const skillName of skillSource) {
      const skill = getSkillFromWorldbook(skillName);
      if (skill) {
        resolvedSkills.push(skill);
      }
    }
    skillSource = resolvedSkills;
  }
  
  console.log(`${enemy.name} 技能源:`, skillSource);
  console.log(`技能数量: ${skillSource?.length || 0}`);
  console.log(`特殊技能开关: ${G.enemySpecialSkillsEnabled !== false ? '开启' : '关闭'}`);
  
  if (!skillSource || skillSource.length === 0) {
    addLog(`${enemy.name}没有可用技能，跳过行动`, 'system');
    return;
  }
  
  const shouldUseSpecialSkills = G.enemySpecialSkillsEnabled !== false;
  
  const vulnerablePlayers = shouldUseSpecialSkills ? G.playerUnits.filter(u => 
    u.hp.current > 0 && 
    (u.clothingIntegrity <= 0 || u.isRestrained)
  ) : [];
  
  let skill = null;
  let target = null;
  
  if (vulnerablePlayers.length > 0) {
    if (!enemy.selectedSpecialSkill) {
      const skill1 = getSkillFromWorldbook('口交侵犯');
      const skill2 = getSkillFromWorldbook('乳房揉弄');
      const skill3 = getSkillFromWorldbook('膣交侵犯');
      const skill4 = getSkillFromWorldbook('肛交侵犯');
      const specialSkills = [skill1, skill2, skill3, skill4].filter(s => s !== null);
      
      if (specialSkills.length > 0) {
        enemy.selectedSpecialSkill = specialSkills[Math.floor(Math.random() * specialSkills.length)];
      }
    }
    
    if (enemy.selectedSpecialSkill) {
    skill = enemy.selectedSpecialSkill;
    const validTargets = vulnerablePlayers.filter(u => u.hp.current > 0);
    if (validTargets.length === 0) return; 
    target = validTargets[Math.floor(Math.random() * validTargets.length)];

      
      if (skill.targetType === 'all_enemies' || skill.targetType === 'all_allies') {
  executeAOESkill(enemy, skill);
      } else if (skill.targetType === 'self') {
        skill.effects.forEach(effect => applyEffect(enemy, effect, enemy));
        enemy.mp.current = Math.max(0, enemy.mp.current - (skill.cost.mp || 0));
        addLog(`${enemy.name}对${target.name}进行了${skill.name}`, 'system');
      } else {
        if (target) {
          executeAttack(enemy, target, skill);
        }
      }
      return;
    }
  } else {

    if (enemy.selectedSpecialSkill) {
      delete enemy.selectedSpecialSkill;
    }
  }
  
  const availableSkills = skillSource.filter(s => {
    if (typeof s === 'string') return false;
    if (s.name === '肉铠化') {
      const hasArmor = enemy.ac && enemy.ac.some(ac => ac.source === '肉铠护甲');
      if (hasArmor) return false;
    }
    const hasResources = enemy.mp.current >= (s.cost?.mp || 0) && enemy.hp.current > (s.cost?.hp || 0);
    const levelSufficient = canUseSkill(enemy, s);
    return hasResources && levelSufficient;
  });

if (availableSkills.length === 0) {
  let targets = G.playerUnits.filter(u => u.hp.current > 0);
  const tauntTargets = targets.filter(u => u.isTaunting);
  if (tauntTargets.length > 0) targets = tauntTargets;

  const aliveTargets = targets.filter(u => u.hp.current > 0);
  if (aliveTargets.length > 0) {
    const target = aliveTargets[Math.floor(Math.random() * aliveTargets.length)];
    executeAttack(enemy, target, { isBasicAttack: true });
  } else {
    addLog(`${enemy.name}没有可用目标，跳过行动`, 'system');
  }
  return;
}

const aoeSkill = availableSkills.find(s => s.targetType === 'all_enemies');
if (aoeSkill) skill = aoeSkill;
else skill = availableSkills[Math.floor(Math.random() * availableSkills.length)];  
  if (!skill) return;
  
if (skill.targetType === 'all_enemies' || skill.targetType === 'all_allies') {
  executeAOESkill(enemy, skill);
} else if (skill.targetType === 'self') {
  skill.effects.forEach(effect => applyEffect(enemy, effect, enemy));
  enemy.mp.current = Math.max(0, enemy.mp.current - (skill.cost?.mp || 0));
} else {
    const targets = getValidTargets(enemy, skill);
    if (targets.length > 0) {
      let validTarget = null;
      for (let t of targets) {
        if (t.hp.current > 0) {
          validTarget = t;
          break;
        }
      }
      if (validTarget) {
        executeAttack(enemy, validTarget, skill);
      } else {
        addLog(`${enemy.name} 没有有效的攻击目标，跳过行动`, 'system');
      }
    }
  }
}

function recalculateActionOrder() {
    const allUnits = [...G.playerUnits, ...G.enemyUnits];
    const canActUnits = [];

    allUnits.forEach(unit => {
        if (unit.hp.current <= 0) return;
        if (unit.isStunned) return;
        if (G.processedUnits.has(unit.id)) return;

        const minCost = getBaseActionCost(unit);
        if (unit.remainingAP < minCost) return;

        canActUnits.push(unit);
    });

    canActUnits.sort((a, b) => {
        if (a.remainingAP !== b.remainingAP) {
            return b.remainingAP - a.remainingAP;
        }
        const spdA = (a.spd || 0) + 100;
        const spdB = (b.spd || 0) + 100;
        return spdB - spdA;
    });

    G.actionQueue = canActUnits;
}

function applyDotDamageToUnit(unit) {
    if (unit.hp.current <= 0) return false;
    
    let totalHpDamage = 0;
    let totalPleasureDamage = 0;
    const dotMessages = [];
    
    (unit.debuffs || []).forEach(debuff => {
        (debuff.effects || []).forEach(effect => {
            if (effect.stat === 'bleed' || effect.stat === 'burn') {
    let dotDamage = 0;
    
    if (effect.currentPercent !== undefined && effect.currentPercent > 0) {
        const source = effect.percentSourceDynamic || effect.percentSource || 'maxHP';
        if (source === 'maxHP') {
            dotDamage = Math.floor(unit.hp.max * effect.currentPercent);
        } else if (source === 'currentHP') {
            dotDamage = Math.floor(unit.hp.current * effect.currentPercent);
        } else {
            dotDamage = Math.floor(unit.hp.max * effect.currentPercent);
        }
    }
    else if (effect.percent && effect.percent > 0) {
        switch (effect.percentSource) {
            case 'maxHP': dotDamage = Math.floor(unit.hp.max * effect.percent); break;
            case 'currentHP': dotDamage = Math.floor(unit.hp.current * effect.percent); break;
            default: dotDamage = Math.floor(unit.hp.max * effect.percent);
        }
    } 
    else {
        dotDamage = effect.value || 0;
    }
    
    if (dotDamage > 0) {
        totalHpDamage += dotDamage;
        dotMessages.push(`${effect.stat === 'bleed' ? '流血' : '灼烧'} ${dotDamage}`);
    }
}
            else if (effect.stat === 'pleasure_dot') {
                const dotValue = effect.value || 0;
                if (dotValue > 0) {
                    totalPleasureDamage += dotValue;
                    dotMessages.push(`情欲 +${dotValue}`);
                }
            }
        });
    });
    
    let died = false;
    
    if (totalHpDamage > 0) {
        const actualDamage = applyDamage(unit, totalHpDamage, false);
        addLog(`${unit.name} 受到持续伤害：${dotMessages.filter(m => !m.includes('情欲')).join('、')}，损失 ${actualDamage} 点生命`, 'damage');
        showFloat(unit, `-${actualDamage}`, 'damage');
        died = checkDeath(unit);
        if (died) return true;
    }
    
    if (totalPleasureDamage > 0) {
        const triggeredOrgasm = addPleasure(unit, totalPleasureDamage, null, null, true);
        addLog(`${unit.name} 受到持续情欲侵蚀 +${totalPleasureDamage}`, 'pleasure');
        if (triggeredOrgasm) {
            updateUI();
            processPendingOrgasm(unit);
            died = checkDeath(unit);
        }
    }
    
    return died;
}

function applyRegenerationEffects(unit) {
    if (unit.hp.current <= 0) return false;

    let regenedHp = 0;
    let regenedMp = 0;
    let regenedShield = 0;

    const allStatuses = [...(unit.buffs || []), ...(unit.debuffs || [])];
    
    allStatuses.forEach(status => {
        (status.effects || []).forEach(effect => {
            if (effect.type === 'regen_hp') {
                let amount = effect.value || 0;
                if (effect.percent) amount = Math.floor(unit.hp.max * amount);
                if (amount > 0) {
                    const oldHp = unit.hp.current;
                    unit.hp.current = Math.min(unit.hp.max, unit.hp.current + amount);
                    const actual = unit.hp.current - oldHp;
                    if (actual > 0) regenedHp += actual;
                }
            }
            else if (effect.type === 'regen_mp') {
                let amount = effect.value || 0;
                if (effect.percent) amount = Math.floor(unit.mp.max * amount);
                if (amount > 0) {
                    const oldMp = unit.mp.current;
                    unit.mp.current = Math.min(unit.mp.max, unit.mp.current + amount);
                    const actual = unit.mp.current - oldMp;
                    if (actual > 0) regenedMp += actual;
                }
            }
            else if (effect.type === 'regen_shield') {
                let amount = effect.value || 0;
                if (effect.percent) amount = Math.floor(unit.hp.max * amount);
                if (amount > 0) {
                    const existing = unit.ac.find(ac => ac.source === '再生护盾');
                    if (existing) {
                        existing.current += amount;
                        if (existing.max) existing.max = Math.max(existing.max, existing.current);
                    } else {
                        unit.ac.push({
                            source: '再生护盾',
                            current: amount,
                            max: amount,
                            remainingTurns: -1,   
                            addTime: Date.now()
                        });
                    }
                    regenedShield += amount;
                }
            }
        });
    });

    if (regenedHp > 0) {
        addLog(`${unit.name} 恢复了 ${regenedHp} 点生命值`, 'heal');
        showFloat(unit, `+${regenedHp}`, 'heal');
    }
    if (regenedMp > 0) {
        addLog(`${unit.name} 恢复了 ${regenedMp} 点法力值`, 'buff');
        showFloat(unit, `+${regenedMp} MP`, 'buff');
    }
    if (regenedShield > 0) {
        addLog(`${unit.name} 获得了 ${regenedShield} 点再生护盾`, 'buff');
        showFloat(unit, `护盾+${regenedShield}`, 'buff');
    }

    return false;  
}

function postActionSettlement(unit) {
  if (unit.hp.current <= 0) return;
  if (unit.isFused && unit.fusionActionRemaining > 0) {
    return;
  }

  unit.buffs = unit.buffs.filter(buff => {
    if (buff.decayOnAttack === true) return true;
    if (buff.duration === undefined && buff.remainingActions !== undefined) {
        buff.duration = buff.remainingActions;
        delete buff.remainingActions;
    }
    if (buff.duration === -1) return true;
    buff.duration--;
    if (buff.effects) {
        buff.effects.forEach(effect => {
            if (effect.duration !== undefined && effect.duration !== -1) {
                effect.duration = buff.duration;
            }
        });
    }
    if (buff.duration <= 0) {
    addLog(`${unit.name}的${buff.name}效果消失`, 'system');
    if (buff.effects?.some(e => e.stat === 'stun')) unit.isStunned = false;

    if (buff.isTransform && buff._originalNewStats) {
        const orig = buff._originalNewStats;
        unit.atk.base = orig.atk;
        unit.matk = orig.matk;
        unit.def = orig.def;
        unit.spd = orig.spd;
        const oldHpMax = unit.hp.max;
        const oldMpMax = unit.mp.max;
        unit.hp.max = orig.hpMax;
        unit.mp.max = orig.mpMax;
        if (oldHpMax > 0 && unit.hp.max > 0) {
            unit.hp.current = Math.min(unit.hp.max, Math.floor(unit.hp.current * (unit.hp.max / oldHpMax)));
        } else {
            unit.hp.current = unit.hp.max;
        }
        if (oldMpMax > 0 && unit.mp.max > 0) {
            unit.mp.current = Math.min(unit.mp.max, Math.floor(unit.mp.current * (unit.mp.max / oldMpMax)));
        } else {
            unit.mp.current = unit.mp.max;
        }
        if (buff._originalStats && unit.stats) {
            unit.stats.constitution = buff._originalStats.constitution;
            unit.stats.intelligence = buff._originalStats.intelligence;
            unit.stats.agility = buff._originalStats.agility;
        }
        delete unit._originalNewStats;
        delete unit._originalStats;
        addLog(`${unit.name} 的变身效果解除`, 'system');
    }
    return false;
}
    return true;
  });

  unit.debuffs = unit.debuffs.filter(debuff => {
    if (debuff.decayOnAttack === true) return true;
    if (debuff.stackable === true) {
        return processStackableStatusTurnEnd(debuff, unit);
    }
    if (debuff.duration === undefined && debuff.remainingActions !== undefined) {
        debuff.duration = debuff.remainingActions;
        delete debuff.remainingActions;
    }
    if (debuff.duration === -1) return true;
    debuff.duration--;
    if (debuff.effects) {
        debuff.effects.forEach(effect => {
            if (effect.duration !== undefined && effect.duration !== -1) {
                effect.duration = debuff.duration;
            }
        });
    }
    if (debuff.name === '肉铠拘束' && debuff.armorRestraint !== undefined && debuff.armorRestraint <= 0) {
      const caster = [...G.playerUnits, ...G.enemyUnits].find(u => u.id === debuff.casterId);
      if (caster) {
        const armorAC = caster.ac.find(ac => ac.source === '肉铠护甲');
        if (armorAC) {
          const idx = caster.ac.indexOf(armorAC);
          if (idx !== -1) caster.ac.splice(idx, 1);
          addLog(`${caster.name}的铠甲护甲因${unit.name}挣脱而消失`, 'system');
        }
      }
      addLog(`${unit.name}的肉铠拘束解除了！`, 'system');
      return false;
    }
    if (debuff.duration <= 0) {
        if (debuff.name === '寄生胎动') {
            addLog(`${unit.name}体内的寄生体停止活动，恢复了行动能力`, 'system');
        } else {
            addLog(`${unit.name}的${debuff.name}效果消失`, 'system');
        }
        if (debuff.name === '高潮恍惚') unit.isStunned = false;
        if (debuff.name === '寄生胎动') unit.isStunned = false;
        updatePleasureBonus(unit);
        const lightning = (unit.debuffs || []).find(d => d.name === '雷电附着');
        if (lightning && (lightning.accumulationCount || 0) >= (lightning.transformationThreshold || 2)) {
            unit.debuffs = unit.debuffs.filter(d => d !== lightning);
            unit.isStunned = true;
            unit.debuffs.push({
                name: '麻痹',
                description: '全身麻痹，无法行动',
                duration: 2,
                type: 'debuff',
                effects: [
                    { stat: 'stun', value: 1, duration: 2 },
                    { stat: 'agility', value: -0.5, duration: 2 }
                ],
                tags: ['debuff', 'lightning']
            });
            addLog(`${unit.name}的雷电附着转化为麻痹！`, 'system');
        }
        applyOrRefreshMentalState(unit);
        const lustStacks = getLustSealStack(unit);
        if (lustStacks > 0) {
            const dot = lustStacks === 1 ? 3 : lustStacks === 2 ? 6 : 10;
            const taken = lustStacks === 1 ? 0.2 : lustStacks === 2 ? 0.25 : 0.35;
            const seal = unit.debuffs.find(d => d.name === '淫纹');
            if (seal) {
                seal.effects = [
                    { stat: 'pleasure_dot', value: dot, duration: -1 },
                    { stat: 'pleasure_damage_taken', value: taken, duration: -1 }
                ];
            }
            updatePleasureBonus(unit);
        }
        return false;
    }
    return true;
  });

  unit.ac = unit.ac.filter(ac => {
    if (ac.remainingTurns === -1) return true;
    ac.remainingTurns--;
    if (ac.remainingTurns <= 0) {
      addLog(`${unit.name}的${ac.source}护甲过期`, 'system');
      return false;
    }
    return true;
  });

  updateHPMPOnStatChange(unit);
  updatePleasureBonus(unit);
}

function endTurn() {
    if (G.phase === 'over') {
        console.log('Game is over, skipping endTurn');
        return;
    }

    if (G.globalCooldowns) {
        for (let skillName in G.globalCooldowns) {
            G.globalCooldowns[skillName]--;
            if (G.globalCooldowns[skillName] <= 0) {
                delete G.globalCooldowns[skillName];
            }
        }
    }

    orgasmCountThisTurn = 0;
    if (checkBattleEnd()) return;

    G.processedUnits.clear();
    G.actionQueue = [];

    tickSkillCooldowns();

    startTurn();
}

function startTurn() {
    if (G.phase === 'over') return;
      [...G.playerUnits, ...G.enemyUnits].forEach(unit => {
    unit._extraActionUsedThisTurn = false;
    unit._extraActionPending = false;
    unit._isExtraAction = false;
  });

    G.turn++;
    G.phase = 'player_turn';
    addLog(`── 第${G.turn}回合 ──`, 'system');
    [...G.playerUnits, ...G.enemyUnits].forEach(unit => {
        if (unit.hp.current <= 0) return;
        const allStatuses = [...(unit.buffs || []), ...(unit.debuffs || [])];
        allStatuses.forEach(status => {
            (status.effects || []).forEach(effect => {
                if (effect.type === 'special_energy_regen') {
                    const typeName = effect.typeName || '通用';
                    const amount = effect.amount || 0;
                    const max = effect.max || 100;
                    if (!unit.specialEnergy) unit.specialEnergy = {};
                    if (!unit.specialEnergy[typeName]) {
                        unit.specialEnergy[typeName] = { current: 0, max: max };
                    }
                    unit.specialEnergy[typeName].current = Math.min(
                        unit.specialEnergy[typeName].current + amount,
                        unit.specialEnergy[typeName].max
                    );
                    addLog(`${unit.name} 恢复 ${amount} 点 ${typeName} 能量（状态效果）`, 'system');
                }
            });
        });
    });

    [...G.playerUnits, ...G.enemyUnits].forEach(unit => {
        if (unit.hp.current <= 0) return;
        unit.remainingAP = (unit.remainingAP || 0) + 100;
            });

    if (checkBattleEnd()) return;

    [...G.playerUnits, ...G.enemyUnits].forEach(unit => {
        if (!unit.isStunned) return;
        const hasStunDebuff = unit.debuffs.some(debuff => 
            (debuff.name === '高潮恍惚' || debuff.name === '寄生胎动') && 
            debuff.remainingActions > 0
        );
        if (!hasStunDebuff && unit.isStunned) {
            unit.isStunned = false;
            const justEndedParasite = unit.debuffs.find(d => d.name === '寄生胎动' && d.remainingActions === 0);
            if (justEndedParasite) {
                addLog(`${unit.name}体内的寄生体停止活动，恢复了行动能力`, 'system');
            } else {
                addLog(`${unit.name}的高潮恍惚状态解除`, 'system');
            }
        }
    });

    recalculateActionOrder();

    if (G.actionQueue.length > 0) {
    G.currentActingUnit = G.actionQueue[0];
    updateUI();
    highlightCurrentUnit(G.currentActingUnit);
    if (G.currentActingUnit.side === 'player') {
    }
    processNextAction();  
} else {
    endTurn();
}
}

function processNextAction() {
    if (G.phase === 'over') return;
    if (G.actionQueue.length === 0) {
        recalculateActionOrder();
        if (G.actionQueue.length === 0) { endTurn(); return; }
    }
    
    const unit = G.actionQueue[0];
    const cost = calculateActionCost(unit);
    
    if (unit.hp.current <= 0 || unit.isStunned || unit.remainingAP < cost) {
        if (G.actionQueue[0] === unit) G.actionQueue.shift();
        G.processedUnits.add(unit.id);
        recalculateActionOrder();
        setTimeout(() => processNextAction(), 100);
        return;
    }

    applyRegenerationEffects(unit);
    const dotDied = applyDotDamageToUnit(unit);
    if (dotDied || unit.hp.current <= 0) {
        if (G.actionQueue[0] === unit) G.actionQueue.shift();
        G.processedUnits.add(unit.id);
        recalculateActionOrder();
        updateUI();
        if (checkBattleEnd()) return;
        setTimeout(() => processNextAction(), 300);
        return;
    }

    if (unit.side === 'enemy') {
        updateUI();
        highlightCurrentUnit(unit);
        G.phase = 'enemy_turn';
        addLog(`${unit.name}开始行动`, 'system');
        logStatusActionText(unit);

        setTimeout(() => {
    if (G.phase === 'over') return;

    if (!unit.isStunned && unit.hp.current > 0) {
        enemyAI(unit);
    } else {
        if (unit.isStunned) outputStunLog(unit);
        else addLog(`${unit.name}无法行动（已战败）`, 'system');
    }

    postActionSettlement(unit);
    updateUI();

    if (checkBattleEnd()) return;

    const canActAgain = (unit.hp.current > 0 && !unit.isStunned && unit.remainingAP >= getBaseActionCost(unit));
    if (!canActAgain) {
        if (G.actionQueue.length > 0 && G.actionQueue[0] === unit) G.actionQueue.shift();
        G.processedUnits.add(unit.id);
    } else {
        recalculateActionOrder();
        if (G.actionQueue.length > 0 && G.actionQueue[0] !== unit) {
        }
    }
    recalculateActionOrder();
    G.phase = 'player_turn';
    G.currentActingUnit = null;

    if (G.actionQueue.length === 0) {
        endTurn();
    } else {
        G.currentActingUnit = G.actionQueue[0];
        setTimeout(() => processNextAction(), 100);
    }
}, 800);
        return;
    }

    // 玩家行动
    G.phase = 'player_turn';
    G.currentActingUnit = unit;
    G.selectedUnit = null;
    G.selectedSkill = null;

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        if (overlay.classList.contains('show') && 
            overlay.id !== 'gameover-modal' && 
            overlay.id !== 'selection-overlay') {
            overlay.classList.remove('show');
        }
    });

    updateUI();
    highlightCurrentUnit(unit);
    addLog(`${unit.name}开始行动`, 'system');
    logStatusActionText(unit);

if (hasStatus(unit, '发情') && Math.random() < 0.5) {
    const dotDied = applyDotDamageToUnit(unit);
    if (dotDied || unit.hp.current <= 0) {
        if (G.actionQueue.length > 0 && G.actionQueue[0] === unit) G.actionQueue.shift();
        G.processedUnits.add(unit.id);
        postActionSettlement(unit);
        updateUI();
        if (checkBattleEnd()) return;
        recalculateActionOrder();
        G.phase = 'player_turn';
        G.currentActingUnit = null;
        if (G.actionQueue.length === 0) endTurn();
        else setTimeout(() => processNextAction(), 500);
        return;
    }
        const forcedSkill = getFrontEndMasturbationSkill();
        if (forcedSkill) {
            const targets = getValidTargets(unit, forcedSkill);
            if (targets.length > 0) {
                const target = targets[Math.floor(Math.random() * targets.length)];
                const arousalLog = getRandomArousalForcedLog(unit);
                if (arousalLog) addLog(arousalLog, 'pleasure');
                executeAttack(unit, target, forcedSkill);
                postActionSettlement(unit);
                updateUI();
                if (checkBattleEnd()) return;
                
                recalculateActionOrder();
                G.phase = 'player_turn';
                G.currentActingUnit = null;
                if (G.actionQueue.length === 0) {
                    endTurn();
                } else {
                    setTimeout(() => processNextAction(), 500);
                }
                return;
            }
        }
    }

    showSkillModal(unit);
}

function renderUnitCard(unit) {
  const wrapper = document.createElement('div');
  wrapper.className = 'unit-wrapper';
  wrapper.id = `unit-wrapper-${unit.id}`;
  
  const card = document.createElement('div');
  card.className = 'unit-card';
  card.id = `unit-${unit.id}`;
  
  if (unit.portraitUrl) {
    card.style.backgroundImage = `url('${unit.portraitUrl}')`;
    card.style.backgroundColor = 'transparent';
  } else {
    card.style.backgroundColor = 'transparent';
  }
  
  if (unit.side === 'enemy') card.classList.add('enemy');
  if (unit.isSummoned) card.classList.add('summoned');
  if (unit.isStunned) card.classList.add('stunned');
  if (unit.isTaunting) card.classList.add('taunting');
  if (unit.hp.current <= 0) card.classList.add('dead');
  if (G.selectedUnit === unit) card.classList.add('selected');
  if (unit.hp.current > 0 && unit.remainingAP < calculateActionCost(unit)) card.classList.add('no-actions');
  
  if (unit.side === 'enemy' && unit.hp.current > 0) {
    const skillViewBtn = document.createElement('div');
    skillViewBtn.className = 'skill-view-btn';
    skillViewBtn.innerHTML = '📖';
    skillViewBtn.style.cssText = `
      position: absolute;
      top: 5px;
      right: 5px;
      width: 28px;
      height: 28px;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(4px);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      cursor: pointer;
      z-index: 10;
      color: white;
      border: 1px solid rgba(255,255,255,0.3);
      transition: all 0.2s ease;
    `;
    skillViewBtn.onclick = (e) => {
      e.stopPropagation();
      showEnemySkills(unit);
    };
    card.appendChild(skillViewBtn);
  }
  
  const dataPanel = document.createElement('div');
  dataPanel.className = 'unit-data-panel';
  
  let statusHtml = '';
  const allStatuses = [...unit.buffs, ...unit.debuffs];
  if (allStatuses.length > 0) {
    statusHtml = '<div class="status-list">';
    allStatuses.forEach(status => {
      const cls = status.type === 'buff' ? 'buff' : 'debuff';
      let displayName = status.displayName || status.name;
      let remainingTurn = status.duration;
      if (status.stackable === true && status.totalLayers > 0) {
        displayName += ` Lv.${status.totalLayers}`;
        if (status.layerDetails && status.layerDetails.length) {
          const minTurns = Math.min(...status.layerDetails.map(l => l.remainingTurns === -1 ? Infinity : l.remainingTurns));
          remainingTurn = isFinite(minTurns) ? minTurns : -1;
        }
      }
      let turnDisplay = '';
      if (remainingTurn === undefined) {
        if (status.stackable === true) {
          const minTurns = Math.min(...(status.layerDetails?.map(l => l.remainingTurns) || [Infinity]));
          remainingTurn = minTurns === Infinity ? -1 : minTurns;
        } else {
          remainingTurn = status.remainingActions ?? status.remainingTurns ?? '?';
        }
      }
      if (remainingTurn === -1) turnDisplay = '∞';
      else if (remainingTurn === '?') turnDisplay = '?';
      else turnDisplay = remainingTurn;
      const titleText = getStatusTooltip(status);
      statusHtml += `<span class="status-tag ${cls}" title="${escapeHtml(titleText)}">${displayName}(${turnDisplay})</span>`;
    });
    statusHtml += '</div>';
  }
  
  let acHtml = '';
  if (unit.ac.length > 0) {
    acHtml = '<div class="ac-list">';
    unit.ac.forEach(ac => {
      acHtml += `<span class="ac-item">${ac.source}: ${ac.current}</span>`;
    });
    acHtml += '</div>';
  }
  
  dataPanel.innerHTML = `
    <div>
      <span class="unit-name">${unit.name}</span>
      <span class="unit-gender">${unit.gender === 'male' ? '♂' : '♀'}</span>
      <span class="unit-level">Lv.${unit.battleLevel}</span>
      ${unit.isBoss ? '<span class="boss-badge" style="background:#c9445a; padding:1px 4px; border-radius:3px; font-size:0.6em; margin-left:5px;">BOSS</span>' : ''}
      ${unit.isSummoned ? '<span class="summon-badge" style="background:#5b8fbf; padding:1px 4px; border-radius:3px; font-size:0.6em;">召唤</span>' : ''}
    </div>
    <div class="bar-group">
      <div class="bar-row">
        <span class="bar-label">HP</span>
        <div class="bar-container"><div class="bar-fill hp" style="width:${(unit.hp.current / unit.hp.max) * 100}%"></div></div>
        <span class="bar-text">${unit.hp.current}/${unit.hp.max}</span>
      </div>
      <div class="bar-row">
        <span class="bar-label">MP</span>
        <div class="bar-container"><div class="bar-fill mp" style="width:${(unit.mp.current / unit.mp.max) * 100}%"></div></div>
        <span class="bar-text">${unit.mp.current}/${unit.mp.max}</span>
      </div>
      <div class="bar-row">
        <span class="bar-label">情欲值</span>
        <div class="bar-container"><div class="bar-fill pleasure" style="width:${(unit.pleasure.current / unit.pleasure.max) * 100}%"></div></div>
        <span class="bar-text">${unit.pleasure.current}/${unit.pleasure.max}</span>
      </div>
      <div class="bar-row">
        <span class="bar-label">服装</span>
        <div class="bar-container"><div class="bar-fill" style="width:${(unit.clothingIntegrity !== undefined ? unit.clothingIntegrity : 100)}%; background: #c49a3c;"></div></div>
        <span class="bar-text">${unit.clothingIntegrity !== undefined ? unit.clothingIntegrity : 100}%</span>
      </div>
      ${(() => {
        if (!unit.specialEnergy || Object.keys(unit.specialEnergy).length === 0) return '';
        return Object.entries(unit.specialEnergy).map(([type, data]) => `
          <div class="bar-row" style="margin-top: 2px;">
            <span class="bar-label" style="color: #c084fc;">${type}</span>
            <div class="bar-container">
              <div class="bar-fill" style="width: ${(data.current / data.max) * 100}%; background: linear-gradient(90deg, #c084fc, #e879a8);"></div>
            </div>
            <span class="bar-text" style="color: #c084fc;">${data.current}/${data.max}</span>
          </div>
        `).join('');
      })()}
      ${unit.consciousnessSystem ? `
      <div class="bar-row" style="margin-top: 2px;">
        <span class="bar-label" style="color: #c084fc;">催眠</span>
        <div class="bar-container"><div class="bar-fill" style="width:${(unit.consciousnessSystem.hypnosisValue / unit.consciousnessSystem.maxHypnosisValue) * 100}%; background: linear-gradient(90deg, #c084fc, #e879a8);"></div></div>
        <span class="bar-text" style="color: #c084fc;">${unit.consciousnessSystem.hypnosisValue}/${unit.consciousnessSystem.maxHypnosisValue}</span>
      </div>
      ${unit.consciousnessSystem.currentState !== 'normal' ? `
      <div style="font-size:0.55em; text-align:center; margin-top:2px; color:#c084fc; background:rgba(192,132,252,0.2); border-radius:3px;">
        🧠 ${unit.consciousnessSystem.currentState === 'bodyControl' ? '身体操作状态' : '常识篡改状态'}
      </div>
      ` : ''}
      ` : ''}
      ${(() => {
        const lustSeal = unit.debuffs?.find(d => d.name === '淫纹');
        const lustStacks = lustSeal?.stacks || 0;
        return lustStacks > 0 ? `
        <div class="bar-row" style="margin-top: 2px;">
          <span class="bar-label" style="color: #e879a8;">🔞淫纹</span>
          <div class="bar-container"><div class="bar-fill" style="width:${(lustStacks / 3) * 100}%; background: linear-gradient(90deg, #e879a8, #c084fc);"></div></div>
          <span class="bar-text" style="color: #e879a8;">Lv.${lustStacks}/3</span>
        </div>
        ` : '';
      })()}
    </div>
    ${acHtml}
    ${statusHtml}
  `;
  wrapper.appendChild(card);
  wrapper.appendChild(dataPanel);
  
  if (unit.side === 'enemy') {
    card.style.cursor = G.targetSelectionMode ? 'crosshair' : 'default';
    if (G.targetSelectionMode) {
      const validTargets = G.pendingAttacker ? getValidTargets(G.pendingAttacker, G.pendingSkill) : [];
      const isValid = validTargets.some(t => t.id === unit.id);
      if (isValid && unit.hp.current > 0) {
        card.classList.add('target-selectable');
        card.onclick = (e) => {
          e.stopPropagation();
          if (G.targetSelectionMode && G.pendingSkill && G.pendingAttacker) {
            showSkillConfirmModal(G.pendingAttacker, unit, G.pendingSkill);
          }
        };
      } else {
        card.onclick = null;
      }
    } else {
      card.onclick = null; 
    }
  } else if (unit.side === 'player') {
    if (G.targetSelectionMode) {
      const validTargets = G.pendingAttacker ? getValidTargets(G.pendingAttacker, G.pendingSkill) : [];
      const isValid = validTargets.some(t => t.id === unit.id);
      if (isValid && unit.hp.current > 0) {
        card.style.cursor = 'crosshair';
        card.classList.add('target-selectable');
        card.onclick = (e) => {
          e.stopPropagation();
          if (G.targetSelectionMode && G.pendingSkill && G.pendingAttacker) {
            showSkillConfirmModal(G.pendingAttacker, unit, G.pendingSkill);
          }
        };
      } else {
        card.style.cursor = 'default';
        card.onclick = null;
      }
    } else {
      const canAct = G.phase === 'player_turn' && 
                     G.currentActingUnit === unit && 
                     !G.processedUnits.has(unit.id) &&
                     !unit.isStunned;
      if (canAct) {
        card.style.cursor = 'pointer';
        card.onclick = () => selectUnit(unit);
      } else {
        card.style.cursor = 'default';
        card.onclick = null;
      }
    }
  }
  
  return wrapper;
}

function selectUnit(unit) {
  if (G.phase !== 'player_turn') {
    addLog('现在不是行动时机', 'system');
    return;
  }
  
  if (G.currentActingUnit !== unit) {
    addLog(`现在轮到 ${G.currentActingUnit?.name || '其他单位'} 行动`, 'system');
    return;
  }
  
  if (unit.isStunned || unit.hp.current <= 0) {
    if (unit.isStunned) {
      outputStunLog(unit);  // 使用新的辅助函数
    } else {
      addLog(`${unit.name} 无法行动（已战败）`, 'system');
    }
    return;
  }
  
  if (G.processedUnits.has(unit.id)) {
    addLog(`${unit.name} 本回合已经行动过了`, 'system');
    return;
  }
  
  // 所有条件满足，弹出技能选择窗口
  G.selectedUnit = unit;
  showSkillModal(unit);
}

function positionModalNearCard(modal, modalContent, cardRect, modalWidth, contentWidth = null, modalHeight = 500) {
  modal.classList.add('positioned');
  let leftPos = cardRect.right + 10;
  if (leftPos + modalWidth > window.innerWidth) leftPos = cardRect.left - modalWidth - 10;
  if (leftPos < 10) leftPos = window.innerWidth / 2;
  let topPos = cardRect.top;
  if (topPos + modalHeight > window.innerHeight) topPos = window.innerHeight - modalHeight - 20;
  if (topPos < 20) topPos = 20;
  modalContent.style.left = `${leftPos}px`;
  modalContent.style.top = `${topPos}px`;
  if (contentWidth) {
    modalContent.style.maxWidth = `${modalWidth}px`;
    modalContent.style.width = `${contentWidth}px`;
  }
}
function resetModalContentStyles(modalContent) {
  if (!modalContent) return;
  modalContent.style.left = '';
  modalContent.style.top = '';
  modalContent.style.maxWidth = '';
  modalContent.style.width = '';
}

function showEnemySkills(enemy) {
  const wrapper = document.getElementById(`unit-wrapper-${enemy.id}`);
  if (!wrapper) return;
  const cardElement = wrapper.querySelector('.unit-card');
  if (!cardElement) return;
  const cardRect = cardElement.getBoundingClientRect();
  const modal = document.getElementById('skill-view-modal');
  const modalContent = modal.querySelector('.modal-content');
  positionModalNearCard(modal, modalContent, cardRect, 400, 380);
  const title = document.getElementById('skill-view-title');
  const list = document.getElementById('skill-view-list');
  title.textContent = `${enemy.name} 的技能列表`;
  list.innerHTML = '';
  const displaySkills = enemy.equippedSkills && enemy.equippedSkills.length > 0 
  ? enemy.equippedSkills 
  : (enemy.learnedSkills && enemy.learnedSkills.length > 0 
      ? enemy.learnedSkills 
      : enemy.skills);
console.log(`显示 ${enemy.name} 的技能:`, displaySkills?.length || 0, '个');
  if (!displaySkills || displaySkills.length === 0) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">该单位没有技能</div>';
    modal.classList.add('show');
    return;
  }
  displaySkills.forEach(skill => {
    const skillDiv = document.createElement('div');
    skillDiv.className = 'skill-item';
    if (skill.actionType === 'attack') skillDiv.classList.add('attack-skill');
    else skillDiv.classList.add('non-attack-skill');
    let effectsHtml = '';
    if (skill.effects && skill.effects.length > 0) {
      effectsHtml = '<div style="margin-top: 6px; padding-left: 10px; border-left: 2px solid #e0e0e0;">';
      effectsHtml += '<span style="font-size: 0.7em; color: #666;">附加效果:</span><br>';
      skill.effects.forEach(effect => {
        let effectDesc = '';
        switch(effect.type) {
          case 'bleed': effectDesc = `流血: ${effect.value}/次，持续${effect.duration}次`; break;
          case 'burn': effectDesc = `灼烧: ${effect.value}/次，持续${effect.duration}次`; break;
          case 'heal': effectDesc = `治疗: ${effect.value} HP`; break;
          case 'shield': effectDesc = `护盾: ${effect.value}点，持续${effect.duration}次`; break;
case 'struggle_hp_loss': effectDesc = `挣扎：损失5%HP`; break;
case 'restraint_reduce': effectDesc = `减少50%拘束度`; break;
case 'heal_percent': effectDesc = `恢复${effect.value}%HP`; break;
case 'pleasure_bonus': effectDesc = `情欲伤害+${effect.value}%`; break;
          default: effectDesc = `${effect.type}: ${effect.value}`;
        }
        effectsHtml += `<div style="font-size: 0.7em; margin: 2px 0;">${effectDesc}</div>`;
      });
      effectsHtml += '</div>';
    }
    let targetTypeText = '';
    switch(skill.targetType) {
      case 'single_enemy': targetTypeText = '单体敌人'; break;
      case 'all_enemies': targetTypeText = '全体敌人'; break;
      case 'single_ally': targetTypeText = '单体友方'; break;
      case 'all_allies': targetTypeText = '全体友方'; break;
      case 'self': targetTypeText = '自身'; break;
      case 'random_enemy': targetTypeText = '随机敌人'; break;
      default: targetTypeText = skill.targetType;
    }
    let damageTypeText = '';
    if (skill.damageType) {
      switch(skill.damageType) {
        case 'physical': damageTypeText = '物理'; break;
        case 'magical': damageTypeText = '魔法'; break;
        case 'agile': damageTypeText = '敏捷'; break;
        case 'pleasure_phy': damageTypeText = '情欲(体)'; break;
        case 'pleasure_mag': damageTypeText = '情欲(智)'; break;
        case 'pleasure_agi': damageTypeText = '情欲(敏)'; break;
        default: damageTypeText = skill.damageType;
      }
    }
    const actionTypeText = skill.actionType === 'attack' ? '攻击' : '非攻击';
    // 构建 HP 伤害/治疗文本
let hpTextEnemy = '';
if (skill.hpDamage !== undefined && skill.hpDamage !== 0) {
  const absHp = Math.abs(skill.hpDamage);
  const isPercent = absHp <= 1 && absHp > 0;
  const valueText = isPercent ? `${(absHp * 100).toFixed(0)}%` : absHp;
  const typeText = skill.hpDamage > 0 ? '伤害' : '治疗';
  hpTextEnemy = ` | ${typeText}: ${valueText} ${isPercent ? '(最大HP)' : '(固定)'}`;
}

// 构建情欲变化文本
let pleasureTextEnemy = '';
if (skill.pleasureDamage !== undefined && skill.pleasureDamage !== 0) {
  const absPleasure = Math.abs(skill.pleasureDamage);
  const isPercent = absPleasure <= 1 && absPleasure > 0;
  const valueText = isPercent ? `${(absPleasure * 100).toFixed(0)}%` : absPleasure;
  const typeText = skill.pleasureDamage > 0 ? '增加' : '减少';
  pleasureTextEnemy = ` | 情欲${typeText}: ${valueText} ${isPercent ? '(最大情欲)' : '(固定)'}`;
}

// 构建属性加成文本
let attrTextEnemy = '';
if (skill.attributeMultiplier && skill.attributeMultiplier !== 0) {
  let attrName = '';
  const dmgType = skill.damageType || 'physical';
  const isPleasure = dmgType.startsWith('pleasure_');
  if (dmgType === 'physical' || dmgType === 'pleasure_phy') attrName = '体质';
  else if (dmgType === 'magical' || dmgType === 'pleasure_mag') attrName = '智力';
  else if (dmgType === 'agile' || dmgType === 'pleasure_agi') attrName = '敏捷';
  else attrName = '体质';
  
  const prefix = isPleasure ? '情欲' : '';
  attrTextEnemy = ` | ${prefix}属性: ${attrName}×${skill.attributeMultiplier}`;
}

skillDiv.innerHTML = `
  <div class="skill-name">
    ${skill.name}
    <span class="skill-target-type ${skill.targetType && skill.targetType.includes('all') ? 'aoe' : ''}">${targetTypeText}</span>
    <span class="skill-action-type ${skill.actionType}">${actionTypeText}</span>
    ${damageTypeText ? `<span style="font-size:0.6em; color:#7c4dca;">${damageTypeText}</span>` : ''}
  </div>
  <div class="skill-info">
    <strong>${skill.description || '无描述'}</strong><br>
    ${skill.cost && skill.cost.mp > 0 ? ` MP: ${skill.cost.mp}` : ''}
    ${skill.cost && skill.cost.hp > 0 ? ` HP: ${skill.cost.hp}` : ''}
    ${(!skill.cost || (skill.cost.mp === 0 && skill.cost.hp === 0)) ? ' 无消耗' : ''}
    ${hpTextEnemy}${pleasureTextEnemy}${attrTextEnemy}
    ${skill.requiredLevel ? ` | <span style="color:#7c4dca;">Lv.${skill.requiredLevel}</span>` : ''}
  </div>
  ${effectsHtml}
`;
    list.appendChild(skillDiv);
  });
  modal.classList.add('show');
}

function showRestraintSkillModal(unit) {
  const wrapper = document.getElementById(`unit-wrapper-${unit.id}`);
  if (!wrapper) return;
  const cardElement = wrapper.querySelector('.unit-card');
  if (!cardElement) return;
  const cardRect = cardElement.getBoundingClientRect();
  
  const modal = document.getElementById('skill-modal');
  const modalContent = modal.querySelector('.modal-content');
  positionModalNearCard(modal, modalContent, cardRect, 450, 430);
  
  const title = document.getElementById('skill-modal-title');
  const list = document.getElementById('skill-list');
  title.textContent = `${unit.name} - 被拘束中（拘束度: ${unit.restraint || 100}）`;
  list.innerHTML = '';
  
const restraintSkills = [
  {
    name: '挣扎',
    type: 'restraint',
    targetType: 'self',
    actionType: ACTION_TYPE.NON_ATTACK,
    damageType: 'physical',
    cost: { hp: 0, mp: 0 },
    multiplier: 0,
    effects: [
      { type: 'struggle_hp_loss', value: 0 },
      { type: 'restraint_reduce', value: 50 }
    ],
    description: '奋力挣扎，损失5%最大HP，减少50点拘束度'
  },
  {
    name: '忍耐',
    type: 'restraint',
    targetType: 'self',
    actionType: ACTION_TYPE.NON_ATTACK,
    damageType: 'physical',
    cost: { hp: 0, mp: 0 },
    multiplier: 0,
    effects: [
      { type: 'heal_percent', value: 10 },
      { type: 'pleasure_current_decrease', value: 20 }
    ],
    description: '忍耐克制，回复自身10%HP，减少情欲值上限20%的当前值'
  },
  {
    name: '沉溺',
    type: 'restraint',
    targetType: 'self',
    actionType: ACTION_TYPE.NON_ATTACK,
    damageType: 'physical',
    cost: { hp: 0, mp: 0 },
    multiplier: 0,
    effects: [
      { type: 'pleasure_current_increase', value: 25 }
    ],
    description: '沉溺于快感，当前情欲值增加情欲值上限的25%'
  }
];
  
  restraintSkills.forEach(skill => {
    const item = document.createElement('div');
    item.className = 'skill-item non-attack-skill';
    
    item.innerHTML = `
      <div class="skill-name">
        ${skill.name}
        <span class="skill-target-type">自身</span>
        <span class="skill-action-type non-attack">非攻击</span>
      </div>
      <div class="skill-info">
        ${skill.description}
        ${skill.cost.mp > 0 ? ` 消耗: MP-${skill.cost.mp}` : ''}
        ${skill.cost.hp > 0 ? ` 消耗: HP-${skill.cost.hp}` : ''}
        ${skill.cost.mp === 0 && skill.cost.hp === 0 ? ' 无消耗' : ''}
      </div>
    `;
    
item.onclick = () => {
  modal.classList.remove('show', 'positioned');
  resetModalContentStyles(modalContent);
  
if (skill.name === '挣扎') {
    const hpLoss = Math.floor(unit.hp.max * 0.05);
    unit.hp.current = Math.max(0, unit.hp.current - hpLoss);
    unit.restraint = Math.max(0, (unit.restraint || 100) - 50);
    
    addLog(`${unit.name}奋力挣扎，损失了${hpLoss}点生命值，拘束度减少至${unit.restraint}`, 'system');
    showFloat(unit, `-${hpLoss}`, 'damage');
    
    if (unit.restraint <= 0) {
      removeRestraint(unit);
      addLog(`${unit.name}成功摆脱了拘束！`, 'system');
    } else {
      const restraintDebuffs = unit.debuffs.filter(d => d.name === '拘束');
      if (restraintDebuffs.length > 1) {
        const firstRestraint = restraintDebuffs[0];
        unit.debuffs = unit.debuffs.filter(d => d.name !== '拘束');
        unit.debuffs.push(firstRestraint);
      }
    }
    
    checkDeath(unit);
} else if (skill.name === '忍耐') {
    const pleasureMax = unit.pleasure.max;
    const decreaseAmount = Math.floor(pleasureMax * 0.20);
    unit.pleasure.current = Math.max(0, unit.pleasure.current - decreaseAmount);
    
    const healAmount = Math.floor(unit.hp.max * 0.10);
    unit.hp.current = Math.min(unit.hp.max, unit.hp.current + healAmount);
    
    addLog(`${unit.name}选择忍耐，恢复了${healAmount}点生命值，情欲值减少了${decreaseAmount}点`, 'heal');
    showFloat(unit, `+${healAmount}`, 'heal');
    showFloat(unit, `-${decreaseAmount}`, 'pleasure');
} else if (skill.name === '沉溺') {
    const pleasureMax = unit.pleasure.max;
    const increaseAmount = Math.floor(pleasureMax * 0.25);
    unit.pleasure.current = Math.min(pleasureMax, unit.pleasure.current + increaseAmount);
    
    addLog(`${unit.name}沉溺于快感，情欲值增加了${increaseAmount}点！`, 'pleasure');
    showFloat(unit, `+${increaseAmount}`, 'pleasure');
}
  
  G.selectedSkill = null;
  G.selectedUnit = null;
  postActionSettlement(unit);
  updateUI();
  
  if (checkBattleEnd()) return;
  
  if (G.actionQueue.length > 0 && G.actionQueue[0] === unit) {
    G.actionQueue.shift();
  }
  G.processedUnits.add(unit.id);
  
  recalculateActionOrder();
  G.phase = 'player_turn';
  G.currentActingUnit = null;
  
  if (G.actionQueue.length === 0) {
    endTurn();
  } else {
    setTimeout(() => processNextAction(), 500);
  }
};
    
    list.appendChild(item);
  });

  // ===== 在拘束状态下也添加侵蚀技能（如果有的话） =====
  const erosionSkills = getErosionSkillsForUnit(unit);
  const unlockedErosionSkills = erosionSkills.filter(s => s.unlocked);
  
  if (unlockedErosionSkills.length > 0) {
    // 添加分隔线
    const divider = document.createElement('div');
    divider.style.cssText = 'margin: 10px 0; border-top: 2px dashed rgba(232, 121, 168, 0.3); padding-top: 10px;';
    divider.innerHTML = '<span style="color:#e879a8; font-size:0.75em;">💕 侵蚀技能（拘束中也可使用）</span>';
    list.appendChild(divider);
    
    unlockedErosionSkills.forEach(skillData => {
      const skill = buildErosionSkillObject(skillData);
      const item = document.createElement('div');
      item.className = 'skill-item attack-skill';
      item.innerHTML = `
        <div class="skill-name">
          💕 ${skill.name}
          <span class="skill-target-type">单体</span>
          <span class="skill-action-type attack">攻击</span>
          <span style="font-size:0.6em; color:#e879a8;">情欲(体)</span>
        </div>
        <div class="skill-info">
          ${skill.description}<br>
          消耗: 无消耗 | 情欲30%+体x0.5
        </div>
      `;
      
      item.onclick = () => {
        modal.classList.remove('show', 'positioned');
        resetModalContentStyles(modalContent);
        
        G.selectedSkill = skill;
        G.selectedUnit = unit;
      };
      
      list.appendChild(item);
    });
  }

  if (unit.isFused) {
    const dissolveItem = document.createElement('div');
    dissolveItem.className = 'skill-item non-attack-skill';
    dissolveItem.style.borderColor = '#c9445a';
    dissolveItem.style.background = 'rgba(201, 68, 90, 0.1)';
    dissolveItem.innerHTML = `
      <div class="skill-name" style="color: #c9445a;">
        ⚡ 解除合体
        <span class="skill-target-type">自身</span>
        <span class="skill-action-type non-attack">特殊</span>
      </div>
      <div class="skill-info">
        立即解散合体，所有原单位将在下一回合重新行动。<br>
        本回合这些单位无法再行动。
      </div>
    `;
    dissolveItem.onclick = () => {
      const modal = document.getElementById('skill-modal');
      modal.classList.remove('show', 'positioned');

      const modalContent = modal.querySelector('.modal-content');
      if (modalContent) {
        resetModalContentStyles(modalContent);
      }
      performDissolveFusion(unit);
    };
    list.appendChild(dissolveItem);
  }
  

  document.getElementById('btn-cancel-skill').onclick = () => {
    modal.classList.remove('show', 'positioned');
    resetModalContentStyles(modalContent);
    G.selectedUnit = null;
    G.selectedSkill = null;
  };
  
  modal.classList.add('show');
}

function showArmorRestraintSkillModal(unit, armorDebuff) {
  const wrapper = document.getElementById(`unit-wrapper-${unit.id}`);
  if (!wrapper) return;
  const cardElement = wrapper.querySelector('.unit-card');
  if (!cardElement) return;
  const cardRect = cardElement.getBoundingClientRect();
  const modal = document.getElementById('skill-modal');
  const modalContent = modal.querySelector('.modal-content');
  positionModalNearCard(modal, modalContent, cardRect, 450);
  const title = document.getElementById('skill-modal-title');
  const list = document.getElementById('skill-list');
  title.textContent = `${unit.name} - 肉铠拘束中（拘束度: ${armorDebuff.armorRestraint || 100}）`;
  list.innerHTML = '';

  const restraintSkills = [
    {
      name: '挣扎',
      type: 'armor_struggle',
      targetType: 'self',
      actionType: 'non_attack',
      effects: [
        { type: 'struggle_hp_loss', value: 0 },
        { type: 'armor_restraint_reduce', value: 50 }
      ],
      description: '奋力挣扎，损失5%最大HP，减少50点铠甲拘束度'
    },
    {
      name: '忍耐',
      type: 'armor_endure',
      targetType: 'self',
      actionType: 'non_attack',
      effects: [
        { type: 'heal_percent', value: 10 },
        { type: 'pleasure_current_decrease', value: 20 }
      ],
      description: '忍耐克制，回复10%HP，减少情欲值上限20%的当前值'
    },
    {
      name: '沉溺',
      type: 'armor_indulge',
      targetType: 'self',
      actionType: 'non_attack',
      effects: [
        { type: 'pleasure_current_increase', value: 25 }
      ],
      description: '沉溺于快感，当前情欲值增加上限的25%'
    }
  ];

  restraintSkills.forEach(skill => {
    const item = document.createElement('div');
    item.className = 'skill-item non-attack-skill';
    item.innerHTML = `
      <div class="skill-name">
        ${skill.name}
        <span class="skill-target-type">自身</span>
        <span class="skill-action-type non-attack">非攻击</span>
      </div>
      <div class="skill-info">${skill.description}</div>
    `;
    item.onclick = () => {
      modal.classList.remove('show', 'positioned');
      modalContent.style.left = '';
      modalContent.style.top = '';
      // 执行技能效果
      skill.effects.forEach(effect => {
        if (effect.type === 'struggle_hp_loss') {
          const hpLoss = Math.floor(unit.hp.max * 0.05);
          unit.hp.current = Math.max(0, unit.hp.current - hpLoss);
          addLog(`${unit.name}奋力挣扎，损失了${hpLoss}点生命值`, 'damage');
          showFloat(unit, `-${hpLoss}`, 'damage');
        }
        if (effect.type === 'armor_restraint_reduce') {
          armorDebuff.armorRestraint = Math.max(0, armorDebuff.armorRestraint - effect.value);
          addLog(`${unit.name}的铠甲拘束度减少至${armorDebuff.armorRestraint}`, 'system');
          if (armorDebuff.armorRestraint <= 0) {
            // 解除护甲和状态
            const caster = [...G.playerUnits, ...G.enemyUnits].find(u => u.id === armorDebuff.casterId);
            if (caster) {
              const armorAC = caster.ac.find(ac => ac.source === '肉铠护甲');
              if (armorAC) {
                const idx = caster.ac.indexOf(armorAC);
                if (idx !== -1) caster.ac.splice(idx, 1);
                addLog(`${caster.name}的铠甲护甲消失了`, 'system');
              }
            }
            const idx = unit.debuffs.indexOf(armorDebuff);
            if (idx !== -1) unit.debuffs.splice(idx, 1);
            addLog(`${unit.name}成功挣脱了肉铠拘束！`, 'system');
          }
        }
        if (effect.type === 'heal_percent') {
          const healAmount = Math.floor(unit.hp.max * (effect.value / 100));
          unit.hp.current = Math.min(unit.hp.max, unit.hp.current + healAmount);
          addLog(`${unit.name}恢复了${healAmount}点生命值`, 'heal');
          showFloat(unit, `+${healAmount}`, 'heal');
        }
        if (effect.type === 'pleasure_current_decrease') {
          const reduce = Math.floor(unit.pleasure.max * (effect.value / 100));
          unit.pleasure.current = Math.max(0, unit.pleasure.current - reduce);
          addLog(`${unit.name}情欲值减少了${reduce}点`, 'pleasure');
        }
        if (effect.type === 'pleasure_current_increase') {
          const increase = Math.floor(unit.pleasure.max * (effect.value / 100));
          unit.pleasure.current = Math.min(unit.pleasure.max, unit.pleasure.current + increase);
          addLog(`${unit.name}情欲值增加了${increase}点`, 'pleasure');
        }
      });
      // 行动后处理
      if (G.actionQueue.length > 0 && G.actionQueue[0] === unit) G.actionQueue.shift();
      G.processedUnits.add(unit.id);
      postActionSettlement(unit);
      updateUI();
      if (checkBattleEnd()) return;
      recalculateActionOrder();
      G.phase = 'player_turn';
      G.currentActingUnit = null;
      if (G.actionQueue.length === 0) endTurn();
      else setTimeout(() => processNextAction(), 500);
    };
    list.appendChild(item);
  });
  document.getElementById('btn-cancel-skill').onclick = () => {
    modal.classList.remove('show', 'positioned');
    modalContent.style.left = '';
    modalContent.style.top = '';
    G.selectedUnit = null;
    G.selectedSkill = null;
  };
  modal.classList.add('show');
}

function showSkillModal(unit) {
  console.log('showSkillModal called for:', unit.name);
  
  const armorRestraint = unit.debuffs.find(d => d.name === '肉铠拘束');
  if (armorRestraint) {
    showArmorRestraintSkillModal(unit, armorRestraint);
    return;
  }
  if (unit.isRestrained) {
    showRestraintSkillModal(unit);
    return;
  }
  
  const wrapper = document.getElementById(`unit-wrapper-${unit.id}`);
  if (!wrapper) {
    console.error('找不到单位包装器:', unit.id);
    return;
  }
  const cardElement = wrapper.querySelector('.unit-card');
  if (!cardElement) {
    console.error('找不到单位卡片:', unit.id);
    return;
  }
  const cardRect = cardElement.getBoundingClientRect();
  const modal = document.getElementById('skill-modal');
  const modalContent = modal.querySelector('.modal-content');
  positionModalNearCard(modal, modalContent, cardRect, 450, 430);
  
  const title = document.getElementById('skill-modal-title');
  const list = document.getElementById('skill-list');
  title.textContent = `${unit.name} - 选择技能`;
  list.innerHTML = '';
  
  let skillPool = [];
  if (unit.equippedSkills && Array.isArray(unit.equippedSkills) && unit.equippedSkills.length > 0) {
    skillPool = unit.equippedSkills.filter(skill => skill && typeof skill === 'object' && skill.name && skill.type !== 'normal');
  }
  if (skillPool.length === 0 && unit.skills && Array.isArray(unit.skills) && unit.skills.length > 0) {
    skillPool = unit.skills.filter(skill => skill && typeof skill === 'object' && skill.name && skill.type !== 'normal');
  }
  if (skillPool.length === 0 && unit.learnedSkills && Array.isArray(unit.learnedSkills) && unit.learnedSkills.length > 0) {
    skillPool = unit.learnedSkills.filter(skill => skill && typeof skill === 'object' && skill.name && skill.type !== 'normal');
  }
  
  skillPool = skillPool.map(skill => {
    if (!skill.type) skill.type = 'skill';
    return skill;
  });
  
  const allSkills = [...skillPool];     
  const erosionSkills = getErosionSkillsForUnit(unit);
  const hasErosionSkills = erosionSkills.length > 0;
  
  if (allSkills.length === 0 && !hasErosionSkills) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">该单位没有可用技能</div>';
    modal.classList.add('show');
    return;
  }
  
  function renderNormalSkillsList() {
    const existingItems = list.querySelectorAll('.skill-item, .erosion-skill-item, .erosion-info');
    existingItems.forEach(el => el.remove());
  
  const basicAttackItem = document.createElement('div');
  basicAttackItem.className = 'skill-item attack-skill';
  basicAttackItem.innerHTML = `
    <div class="skill-name">
      ⚔️ 普通攻击
      <span class="skill-target-type">单体</span>
      <span class="skill-action-type attack">攻击</span>
    </div>
    <div class="skill-info">基础攻击，造成 物攻×1.0 伤害</div>
  `;
  basicAttackItem.onclick = () => {
    modal.classList.remove('show', 'positioned');
    resetModalContentStyles(modalContent);
    enterTargetSelectionMode(unit, {
      isBasicAttack: true,
      name: '普通攻击',
      description: '对敌人造成一次基础物理伤害',
      targetType: 'single_enemy',
      actionType: ACTION_TYPE.ATTACK,
      damageType: 'physical',
      attributeMultiplier: 1.0,
      hpDamage: 0,
    });
  };
  list.appendChild(basicAttackItem);

  allSkills.forEach(skill => {
      const item = document.createElement('div');
      item.className = 'skill-item';
      const isPassiveSkill = skill._isPassive === true || 
                             (skill.effects && skill.effects.length === 1 && skill.effects[0].type === 'battle_start_aura');
      
      if (skill.type === 'fusion') {
        item.innerHTML = `
          <div class="skill-name">
            ${skill.name}
            <span class="skill-target-type">特殊</span>
            <span class="skill-action-type non-attack">非攻击</span>
          </div>
          <div class="skill-info">${skill.description}<br>消耗: ${skill.cost?.mp > 0 ? `MP-${skill.cost.mp}` : '无消耗'}</div>
        `;
        item.onclick = () => {
          modal.classList.remove('show', 'positioned');
          resetModalContentStyles(modalContent);
          showFusionSelection(unit, skill);
        };
        list.appendChild(item);
        return;
      }
      
      if (skill.type === 'dissolve') {
        item.classList.add('non-attack-skill');
        item.style.borderColor = '#c9445a';
        item.style.background = 'rgba(201, 68, 90, 0.1)';
        item.innerHTML = `
          <div class="skill-name" style="color: #c9445a;">
            ⚡ ${skill.name}
            <span class="skill-target-type">自身</span>
            <span class="skill-action-type non-attack">特殊</span>
          </div>
          <div class="skill-info">${skill.description}</div>
        `;
        item.onclick = () => {
          modal.classList.remove('show', 'positioned');
          resetModalContentStyles(modalContent);
          performDissolveFusion(unit);
        };
        list.appendChild(item);
        return;
      }
      
      if (isPassiveSkill) {
        let targetLabel = skill.targetType === 'single_enemy' ? '单体' : (skill.targetType === 'all_enemies' ? '全体' : '被动');
        const actionLabel = skill.actionType === ACTION_TYPE.ATTACK ? '攻击' : '非攻击';
        item.innerHTML = `
          <div class="skill-name">
            ${skill.name}
            <span class="skill-target-type">${targetLabel}</span>
            <span class="skill-action-type ${skill.actionType}">${actionLabel}</span>
          </div>
          <div class="skill-info">${skill.description}<br>${skill.cost?.mp > 0 ? `消耗: MP-${skill.cost.mp}` : '无消耗'}${skill.requiredLevel ? ` | 需要Lv.${skill.requiredLevel}` : ''}</div>
        `;
        item.classList.add('disabled');
        item.style.pointerEvents = 'none';
        item.onclick = null;
        item.title = '被动技能，已自动生效';
        list.appendChild(item);
        return;
      }
      
      let hasResources = true;
      let levelSufficient = true;
      let canUse = true;
      if (skill.type !== 'transform') {
        hasResources = unit.mp.current >= (skill.cost?.mp || 0) && unit.hp.current > (skill.cost?.hp || 0);
        levelSufficient = canUseSkill(unit, skill);
        canUse = hasResources && levelSufficient;
      }
      if (!canUse && skill.type !== 'transform') item.classList.add('disabled');
      if (skill.actionType === ACTION_TYPE.ATTACK) item.classList.add('attack-skill');
      else item.classList.add('non-attack-skill');
      if (skill.targetType === 'all_enemies') item.classList.add('aoe-skill');
      if (skill.targetType === 'all_allies' || (skill.effects && skill.effects.some(e => e.type === 'heal' || e.type === 'mp_restore' || e.type === 'shield'))) {
        item.classList.add('heal-skill');
      }
      
      let targetLabel = '';
      switch (skill.targetType) {
        case 'single_enemy': targetLabel = '单体'; break;
        case 'all_enemies': targetLabel = '全体'; break;
        case 'single_ally': targetLabel = '友方'; break;
        case 'all_allies': targetLabel = '全体友方'; break;
        case 'random_enemy': targetLabel = '随机'; break;
        case 'self': targetLabel = '自身'; break;
        default: targetLabel = skill.targetType;
      }
      const actionLabel = skill.actionType === ACTION_TYPE.ATTACK ? '攻击' : '非攻击';
      let disabledReason = '';
      if (skill.type !== 'transform') {
        if (!hasResources) disabledReason = '(资源不足)';
        else if (!levelSufficient) disabledReason = `(需要Lv.${getSkillRequiredLevel(skill)})`;
      }
      let damageTypeText = '';
      if (skill.damageType) {
        switch(skill.damageType) {
          case 'physical': damageTypeText = '物理'; break;
          case 'magical': damageTypeText = '魔法'; break;
          case 'agile': damageTypeText = '敏捷'; break;
          case 'pleasure_phy': damageTypeText = '情欲(体)'; break;
          case 'pleasure_mag': damageTypeText = '情欲(智)'; break;
          case 'pleasure_agi': damageTypeText = '情欲(敏)'; break;
        }
      }
      let cooldownInfo = '';
      if (skill.cooldown && unit.skillCooldowns && unit.skillCooldowns[skill.name] > 0) {
        cooldownInfo = `<span style="color:#c49a3c;"> (冷却中: ${unit.skillCooldowns[skill.name]}回合)</span>`;
      } else if (skill.cooldown) {
        cooldownInfo = `<span style="color:#5aaa8a;"> (冷却: ${skill.cooldown}回合)</span>`;
      }
      let hpText = '';
if (skill.hpDamage !== undefined && skill.hpDamage !== 0) {
  const absHp = Math.abs(skill.hpDamage);
  const isPercent = absHp <= 1 && absHp > 0;
  const valueText = isPercent ? `${(absHp * 100).toFixed(0)}%` : absHp;
  const typeText = skill.hpDamage > 0 ? '伤害' : '治疗';
  
  let extra = '';
  if (skill.hpDamage > 0) {
    // 多属性加成
    if (skill.attributeMultipliers) {
      const attrParts = [];
      for (const [attr, mult] of Object.entries(skill.attributeMultipliers)) {
        if (mult !== 0) {
          let attrName = '';
          if (attr === 'constitution') attrName = '体质';
          else if (attr === 'intelligence') attrName = '智力';
          else if (attr === 'agility') attrName = '敏捷';
          else attrName = attr; 
          attrParts.push(`${attrName}×${mult}`);
        }
      }
      if (attrParts.length > 0) {
        extra += ` + ${attrParts.join(' + ')}`;
      }
    }
    // 能量动态加成
    if (skill.energyDamageBonus) {
      const bonus = skill.energyDamageBonus;
      const minText = bonus.min ? `≥${bonus.min}` : '';
      extra += ` + (当${bonus.typeName}${minText}时，每点+${bonus.multiplier})`;
    }
  }
  hpText = ` | ${typeText}: ${valueText}${extra} ${isPercent ? '(最大HP)' : ''}`;
}

// 构建情欲变化文本
let pleasureText = '';
if (skill.pleasureDamage !== undefined && skill.pleasureDamage !== 0) {
  const absPleasure = Math.abs(skill.pleasureDamage);
  const isPercent = absPleasure <= 1 && absPleasure > 0;
  const valueText = isPercent ? `${(absPleasure * 100).toFixed(0)}%` : absPleasure;
  const typeText = skill.pleasureDamage > 0 ? '增加' : '减少';
  pleasureText = ` | 情欲${typeText}: ${valueText} ${isPercent ? '(最大情欲)' : '(固定)'}`;
}

// 构建属性加成文本
let attrText = '';
if (skill.attributeMultiplier && skill.attributeMultiplier !== 0) {
  let attrName = '';
  const dmgType = skill.damageType || 'physical';
  const isPleasure = dmgType.startsWith('pleasure_');
  if (dmgType === 'physical' || dmgType === 'pleasure_phy') attrName = '体质';
  else if (dmgType === 'magical' || dmgType === 'pleasure_mag') attrName = '智力';
  else if (dmgType === 'agile' || dmgType === 'pleasure_agi') attrName = '敏捷';
  else attrName = '体质';
  
  const prefix = isPleasure ? '情欲' : '';
  attrText = ` | ${prefix}属性: ${attrName}×${skill.attributeMultiplier}`;
}

item.innerHTML = `
  <div class="skill-name">
    ${skill.name}
    <span class="skill-target-type ${skill.targetType && skill.targetType.includes('all') ? 'aoe' : ''} ${skill.targetType && (skill.targetType.includes('ally') || (skill.effects && skill.effects.some(e => e.type === 'heal'))) ? 'heal' : ''}">${targetLabel}</span>
    <span class="skill-action-type ${skill.actionType}">${actionLabel}</span>
    ${damageTypeText ? `<span style="font-size:0.6em;">${damageTypeText}</span>` : ''}
    ${skill.type === 'transform' ? '<span style="background:#c084fc; color:white; padding:2px 6px; border-radius:4px; font-size:0.6em;">变身</span>' : ''}
  </div>
  <div class="skill-info">
    ${skill.description} ${disabledReason}${cooldownInfo}<br>
    消耗: ${skill.cost?.mp > 0 ? `MP-${skill.cost.mp}` : ''} ${skill.cost?.hp > 0 ? `HP-${skill.cost.hp}` : ''}
    ${(!skill.cost || (skill.cost.mp === 0 && skill.cost.hp === 0)) ? '无消耗' : ''}
    ${(() => {
      if (skill.cost && skill.cost.specialEnergy) {
        const entries = Object.entries(skill.cost.specialEnergy);
        return ' | 特殊消耗: ' + entries.map(([type, val]) => `${type} ${val}`).join(' ');
      }
      return '';
    })()}
    ${hpText}${pleasureText}${attrText}
    ${getSkillRequiredLevel(skill) > 0 && skill.type !== 'transform' ? ` | <span style="color:${levelSufficient ? '#5aaa8a' : '#c49a3c'};">Lv.${getSkillRequiredLevel(skill)}</span>` : ''}
  </div>
`;
      
      item.onclick = () => {
        if (skill._isPassive === true) return;
        if (skill.type !== 'transform') {
          const hasMp = unit.mp.current >= (skill.cost?.mp || 0);
          const hasHp = unit.hp.current > (skill.cost?.hp || 0);
          const levelOk = canUseSkill(unit, skill);
          if (!hasMp || !hasHp || !levelOk) return;
        }
        
        modal.classList.remove('show', 'positioned');
        resetModalContentStyles(modalContent);
        
        if (skill.targetType === 'all_enemies' || skill.targetType === 'all_allies') {
          showAOEConfirmModal(unit, skill);
          return;
        }
        
        if (skill.targetType === 'self') {
          modal.classList.remove('show', 'positioned');
          resetModalContentStyles(modalContent);
          showSelfSkillConfirmModal(unit, skill);
          return;
        }
        
        enterTargetSelectionMode(unit, skill);
      };
      list.appendChild(item);
    });
  }
  
  function renderErosionSkillsList() {
    const existingItems = list.querySelectorAll('.skill-item, .erosion-skill-item, .erosion-info');
    existingItems.forEach(el => el.remove());
    const erosionInfo = document.createElement('div');
    erosionInfo.className = 'erosion-info';
    erosionInfo.style.cssText = `
      text-align: center;
      padding: 8px;
      margin-bottom: 8px;
      background: rgba(232, 121, 168, 0.1);
      border: 1px solid rgba(232, 121, 168, 0.3);
      border-radius: 6px;
      font-size: 0.8em;
      color: var(--pleasure-color);
    `;
    erosionInfo.innerHTML = `💕 当前侵蚀值: <strong>${getUnitErosionValue(unit)}</strong> / 300`;
    list.appendChild(erosionInfo);
    
    erosionSkills.forEach(skillData => {
      const skill = buildErosionSkillObject(skillData);
      const unlocked = skillData.unlocked;
      const item = document.createElement('div');
      item.className = 'skill-item attack-skill erosion-skill-item';
      if (!unlocked) {
        item.classList.add('disabled');
        item.style.opacity = '0.5';
        item.style.cursor = 'not-allowed';
      }
      const damageTypeText = skill.damageType === 'pleasure_phy' ? '情欲(体)' : 
                             skill.damageType === 'pleasure_agi' ? '情欲(敏)' : '情欲(智)';
      let effectsDesc = '';
      if (skillData.effects && skillData.effects.length > 0) {
        effectsDesc = '<div style="margin-top:4px; font-size:0.7em; color:#c084fc;">附加效果: ';
        skillData.effects.forEach((effect, i) => {
          if (i > 0) effectsDesc += ' | ';
          switch(effect.type) {
            case 'pleasure_dot': effectsDesc += `情欲持续伤害+${effect.value}/回合(${effect.duration}回合)`; break;
            case 'pleasure_up': effectsDesc += `情欲易伤+${(effect.value*100).toFixed(0)}%(${effect.duration}回合)`; break;
            case 'stun': effectsDesc += `眩晕(${effect.duration}回合)`; break;
            default: effectsDesc += `${effect.type}`;
          }
        });
        effectsDesc += '</div>';
      }
      let erosionPleasureText = '';
if (skill.pleasureDamage !== undefined && skill.pleasureDamage !== 0) {
  const absPleasure = Math.abs(skill.pleasureDamage);
  const isPercent = absPleasure <= 1 && absPleasure > 0;
  const valueText = isPercent ? `${(absPleasure * 100).toFixed(0)}%` : absPleasure;
  const typeText = skill.pleasureDamage > 0 ? '增加' : '减少';
  erosionPleasureText = `情欲${typeText}: ${valueText} ${isPercent ? '(最大情欲)' : '(固定)'}`;
}

let erosionAttrText = '';
if (skill.damageAttribute && skill.attributeMultiplier) {
  const attrName = skill.damageAttribute === 'constitution' ? '体质' : (skill.damageAttribute === 'intelligence' ? '智力' : '敏捷');
  erosionAttrText = ` | 属性: ${attrName}×${skill.attributeMultiplier}`;
}

item.innerHTML = `
  <div class="skill-name">
    💕 ${skill.name}
    <span class="skill-target-type">单体</span>
    <span class="skill-action-type attack">攻击</span>
    <span style="font-size:0.6em; color:#e879a8;">${damageTypeText}</span>
    <span style="background:rgba(232,121,168,0.2); color:#e879a8; padding:2px 6px; border-radius:4px; font-size:0.6em;">侵蚀技</span>
  </div>
  <div class="skill-info">
    ${skill.description}<br>
    消耗: 无消耗 | ${erosionPleasureText}${erosionAttrText}
    ${!unlocked ? `<br><span style="color:#c9445a;">🔒 需要侵蚀值 ≥ ${skillData.erosionRequired} (当前: ${skillData.currentErosion})</span>` : 
      `<br><span style="color:#5aaa8a;">✅ 已解锁 (侵蚀值 ${skillData.currentErosion} ≥ ${skillData.erosionRequired})</span>`}
    ${effectsDesc}
  </div>
`;
      if (unlocked) {
        item.onclick = () => {
          modal.classList.remove('show', 'positioned');
          resetModalContentStyles(modalContent);
          enterTargetSelectionMode(unit, skill);
        };
      } else {
        item.onclick = () => {};
      }
      list.appendChild(item);
    });
  }
  
  if (hasErosionSkills) {
    const tabContainer = document.createElement('div');
    tabContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 12px;';
    const normalTab = document.createElement('button');
    normalTab.textContent = '⚔️ 常规技能';
    normalTab.className = 'gem-button';
    normalTab.style.cssText = 'flex:1; padding:6px; font-size:0.75em; background: linear-gradient(135deg, var(--primary-500), var(--primary-600));';
    const erosionTab = document.createElement('button');
    erosionTab.textContent = '💕 侵蚀技能';
    erosionTab.className = 'gem-button secondary';
    erosionTab.style.cssText = 'flex:1; padding:6px; font-size:0.75em;';
    
    normalTab.onclick = () => {
      normalTab.style.background = 'linear-gradient(135deg, var(--primary-500), var(--primary-600))';
      erosionTab.style.background = 'linear-gradient(135deg, var(--neutral-400), var(--neutral-500))';
      renderNormalSkillsList();
    };
    erosionTab.onclick = () => {
      erosionTab.style.background = 'linear-gradient(135deg, var(--primary-500), var(--primary-600))';
      normalTab.style.background = 'linear-gradient(135deg, var(--neutral-400), var(--neutral-500))';
      renderErosionSkillsList();
    };
    tabContainer.appendChild(normalTab);
    tabContainer.appendChild(erosionTab);
    list.appendChild(tabContainer);
    renderNormalSkillsList();
  } else {
    renderNormalSkillsList();
  }
  
  document.getElementById('btn-cancel-skill').onclick = () => {
    modal.classList.remove('show', 'positioned');
    resetModalContentStyles(modalContent);
    G.selectedUnit = null;
    G.selectedSkill = null;
  };
  
  modal.classList.add('show');
}

function enterTargetSelectionMode(attacker, skill) {
  if (skill.isBasicAttack) {
    if (!skill.name) skill.name = '普通攻击';
    if (!skill.description) skill.description = '对敌人造成一次基础物理伤害';
    if (!skill.targetType) skill.targetType = 'single_enemy';
    if (!skill.actionType) skill.actionType = ACTION_TYPE.ATTACK;
  }
  
  exitTargetSelectionMode();
  G.targetSelectionMode = true;
  G.pendingSkill = skill;
  G.pendingAttacker = attacker;
  
  updateUI();
  
  const cancelHint = document.createElement('div');
  cancelHint.id = 'target-cancel-hint';
  cancelHint.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.7);
    color: white;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.8em;
    z-index: 2000;
    cursor: pointer;
    backdrop-filter: blur(4px);
  `;
  cancelHint.innerHTML = '✖ 取消目标选择 (点击此处或鼠标右键)';
  cancelHint.onclick = () => exitTargetSelectionMode();
  document.body.appendChild(cancelHint);
  
  window._targetSelectionRightClickHandler = (e) => {
  e.preventDefault();         
  exitTargetSelectionMode();
};
document.addEventListener('contextmenu', window._targetSelectionRightClickHandler);
  updateActionOrderBar({ unit: attacker, skill: skill });
}

function exitTargetSelectionMode() {
  G.targetSelectionMode = false;
  G.pendingSkill = null;
  G.pendingAttacker = null;
  
  const hint = document.getElementById('target-cancel-hint');
  if (hint) hint.remove();
  
  if (window._targetSelectionRightClickHandler) {
  document.removeEventListener('contextmenu', window._targetSelectionRightClickHandler);
  delete window._targetSelectionRightClickHandler;
}
  
  updateUI();
  updateActionOrderBar();
}

function getDamagePreviewText(attacker, defender, skill, isAOE = false) {
  if (!skill) return '';

  if (skill.actionType === ACTION_TYPE.NON_ATTACK) return '';

  let previewHtml = '';

  if (!isAOE && defender) {
    const { hpChange, pleasureChange } = calculateSkillEffects(attacker, defender, skill);
    const hpDamage = hpChange > 0 ? Math.ceil(hpChange) : 0;
    const pleasureDamage = pleasureChange > 0 ? Math.ceil(pleasureChange) : 0;

    if (hpDamage > 0) {
      previewHtml += `<div>⚔️ 预计伤害: <strong style="color:#c9445a;">${hpDamage}</strong> 点生命</div>`;
    }
    if (pleasureDamage > 0) {
      previewHtml += `<div>💕 预计情欲伤害: <strong style="color:#e879a8;">${pleasureDamage}</strong> 点</div>`;
    }
  }
  else if (isAOE) {
    let totalHp = 0, totalPleasure = 0;
    const targets = getValidTargets(attacker, skill);
    targets.forEach(t => {
      const { hpChange, pleasureChange } = calculateSkillEffects(attacker, t, skill);
      totalHp += hpChange > 0 ? Math.ceil(hpChange) : 0;
      totalPleasure += pleasureChange > 0 ? Math.ceil(pleasureChange) : 0;
    });
    if (totalHp > 0) {
      previewHtml += `<div>⚔️ 总伤害预估: <strong style="color:#c9445a;">${totalHp}</strong> 点生命 (对 ${targets.length} 个目标)</div>`;
    }
    if (totalPleasure > 0) {
      previewHtml += `<div>💕 总情欲伤害预估: <strong style="color:#e879a8;">${totalPleasure}</strong> 点</div>`;
    }
  }

  return previewHtml;
}

function showSkillConfirmModal(attacker, defender, skill) {
  exitTargetSelectionMode();
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.style.zIndex = '2001';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  
  const actualCost = calculateActionCost(attacker, skill);
  const baseCost = getBaseActionCost(attacker);
  const costDiff = actualCost - baseCost;
  const costText = costDiff < 0 ? `减少 ${-costDiff}` : (costDiff > 0 ? `增加 ${costDiff}` : '不变');
  
  const damagePreview = getDamagePreviewText(attacker, defender, skill, false);

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px; text-align: center; animation: modal-appear 0.2s ease;">
      <h2 class="modal-title">确认使用技能</h2>
      <div style="margin: 15px 0;">
        <p><strong>${attacker.name}</strong> 对 <strong>${defender.name}</strong> 使用</p>
        <p style="font-size: 1.2em; color: var(--primary-600);">【${skill.name}】</p>
        <p style="font-size: 0.8em; color: #666;">${skill.description || '无描述'}</p>
        <hr>
        <div style="text-align: left; font-size: 0.8em;">
          ${damagePreview ? `<div style="margin-bottom: 8px; padding: 5px; background: rgba(124,77,202,0.1); border-radius: 4px;">${damagePreview}</div>` : ''}
          <div>💰 消耗: ${skill.cost?.mp > 0 ? `MP ${skill.cost.mp}` : ''} ${skill.cost?.hp > 0 ? `HP ${skill.cost.hp}` : ''} ${(!skill.cost || (skill.cost.mp === 0 && skill.cost.hp === 0)) ? '无消耗' : ''}</div>
          <div>⏱️ 行动消耗: ${baseCost} → ${actualCost} (${costText})</div>
        </div>
      </div>
      <div style="display: flex; gap: 10px; justify-content: center;">
        <button class="gem-button" id="confirm-skill-use">确认使用</button>
        <button class="gem-button secondary" id="cancel-skill-use">取消</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  const confirmBtn = modal.querySelector('#confirm-skill-use');
  const cancelBtn = modal.querySelector('#cancel-skill-use');
  
  confirmBtn.onclick = () => {
    modal.remove();
    executeAttack(attacker, defender, skill);
    
    // 合体单位处理
    if (attacker.isFused) {
      attacker.fusionActionRemaining--;
      if (attacker.fusionActionRemaining > 0) {
        addLog(`${attacker.name} 还可以行动 ${attacker.fusionActionRemaining} 次`, 'system');
        recalculateActionOrder();
        setTimeout(() => processNextAction(), 100);
        return;
      }
    }
    
    // 行动后刷新界面并继续
    recalculateActionOrder();
    G.phase = 'player_turn';
    G.currentActingUnit = null;
    G.selectedSkill = null;
    G.selectedUnit = null;
    updateUI();
    if (checkBattleEnd()) return;
    if (G.actionQueue.length === 0) endTurn();
    else setTimeout(() => processNextAction(), 500);
  };
  
  cancelBtn.onclick = () => {
    modal.remove();
    enterTargetSelectionMode(attacker, skill);
  };
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
      enterTargetSelectionMode(attacker, skill);
    }
  };
}

function showSelfSkillConfirmModal(unit, skill) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.style.zIndex = '2001';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  
  const actualCost = calculateActionCost(unit, skill);
  const baseCost = getBaseActionCost(unit);
  const costDiff = actualCost - baseCost;
  const costText = costDiff < 0 ? `减少 ${-costDiff}` : (costDiff > 0 ? `增加 ${costDiff}` : '不变');
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px; text-align: center; animation: modal-appear 0.2s ease;">
      <h2 class="modal-title">确认使用技能</h2>
      <div style="margin: 15px 0;">
        <p><strong>${unit.name}</strong> 对 <strong>自身</strong> 使用</p>
        <p style="font-size: 1.2em; color: var(--primary-600);">【${skill.name}】</p>
        <p style="font-size: 0.8em; color: #666;">${skill.description || '无描述'}</p>
        <hr>
        <div style="text-align: left; font-size: 0.8em;">
          <div>💰 消耗: ${skill.cost?.mp > 0 ? `MP ${skill.cost.mp}` : ''} ${skill.cost?.hp > 0 ? `HP ${skill.cost.hp}` : ''} ${(!skill.cost || (skill.cost.mp === 0 && skill.cost.hp === 0)) ? '无消耗' : ''}</div>
          <div>⏱️ 行动消耗: ${baseCost} → ${actualCost} (${costText})</div>
        </div>
      </div>
      <div style="display: flex; gap: 10px; justify-content: center;">
        <button class="gem-button" id="confirm-self-skill">确认使用</button>
        <button class="gem-button secondary" id="cancel-self-skill">取消</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  const confirmBtn = modal.querySelector('#confirm-self-skill');
  const cancelBtn = modal.querySelector('#cancel-self-skill');
  
  confirmBtn.onclick = () => {
    modal.remove();
    executeAttack(unit, unit, skill);
    if (unit.isFused) {
      unit.fusionActionRemaining--;
      if (unit.fusionActionRemaining > 0) {
        addLog(`${unit.name} 还可以行动 ${unit.fusionActionRemaining} 次`, 'system');
        recalculateActionOrder();
        setTimeout(() => processNextAction(), 100);
        return;
      }
    }
    if (G.actionQueue.length > 0 && G.actionQueue[0] === unit) G.actionQueue.shift();
    G.processedUnits.add(unit.id);
    postActionSettlement(unit);
    updateUI();
    if (checkBattleEnd()) return;
    recalculateActionOrder();
    G.phase = 'player_turn';
    G.currentActingUnit = null;
    if (G.actionQueue.length === 0) endTurn();
    else setTimeout(() => processNextAction(), 500);
  };
  
  cancelBtn.onclick = () => {
    modal.remove();
    showSkillModal(unit);
  };
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
      showSkillModal(unit);
    }
  };
}

function configureTargetListGrid(list, minWidth, gap, maxHeight) {
    list.style.display = 'grid';
    list.style.gridTemplateColumns = `repeat(auto-fill, minmax(${minWidth}, 1fr))`;
    list.style.gap = gap;
    if (maxHeight) list.style.maxHeight = maxHeight;
}
function resetTargetListLayout(list) {
    list.style.display = '';
    list.style.gridTemplateColumns = '';
    list.style.gap = '';
    list.style.maxHeight = '';
}
function renderSimplifiedTargetCard(unit, attacker) {
    return renderUnitCard(unit); 
}

function showFusionSelection(attacker, fusionSkill) {   
  const confirmBtn = document.getElementById('btn-confirm-aoe');
  if (!confirmBtn) return;
  const availableUnits = G.playerUnits.filter(u => u.hp.current > 0 && !u.isFused);
  if (availableUnits.length < 2) {
    addLog('没有足够的单位可以合体（至少需要2名存活且未合体的单位）', 'system');
    return;
  }

  const modal = document.getElementById('target-modal');
  const modalContent = modal.querySelector('.modal-content');
  const title = document.getElementById('target-modal-title');
  const list = document.getElementById('target-list');

  title.textContent = '选择合体成员（2-6人）';
  list.innerHTML = '';
  configureTargetListGrid(list, '180px', '12px', null);

  const selected = new Set();
  const maxCount = 6;
  const minCount = 2;

  availableUnits.forEach(unit => {
    const wrapper = renderSimplifiedTargetCard(unit, attacker);
    const card = wrapper.querySelector('.unit-card');
    card.style.cursor = 'pointer';
    card.onclick = (e) => {
      e.stopPropagation();
      if (selected.has(unit.id)) {
        selected.delete(unit.id);
        card.classList.remove('selected');
        card.style.borderColor = '';
      } else {
        if (selected.size >= maxCount) {
          addLog(`最多只能选择 ${maxCount} 个单位`, 'system');
          return;
        }
        selected.add(unit.id);
        card.classList.add('selected');
        card.style.borderColor = '#3b82f6';
      }
      confirmBtn.disabled = (selected.size < minCount);
    };
    list.appendChild(wrapper);
  });

  confirmBtn.style.display = 'inline-block';
  confirmBtn.textContent = '确认合体';
  confirmBtn.disabled = true; // 初始不可选

  confirmBtn.onclick = () => {
    if (selected.size < minCount) {
      addLog(`请至少选择 ${minCount} 名单位`, 'system');
      return;
    }
    const selectedUnits = availableUnits.filter(u => selected.has(u.id));
    
    const success = createFusionUnit(selectedUnits, attacker);
    if (!success) {
      addLog('合体失败，请检查日志', 'system');
      return;
    }

    if (fusionSkill && fusionSkill.name) {
      G.globalCooldowns[fusionSkill.name] = 5;
      addLog(`${fusionSkill.name} 进入5回合全局冷却`, 'system');
    }
    
    if (fusionSkill && fusionSkill.cost?.mp) {
      if (attacker.mp.current >= fusionSkill.cost.mp) {
        attacker.mp.current -= fusionSkill.cost.mp;
        addLog(`${attacker.name} 消耗 ${fusionSkill.cost.mp} MP 使用合体`, 'system');
      } else {
        addLog(`${attacker.name} MP不足，合体失败`, 'system');
        return;
      }
    }
    
    modal.classList.remove('show');
    resetModalContentStyles(modalContent);
    resetTargetListLayout(list);
    confirmBtn.style.display = 'none';
    
    const attackerIndex = G.actionQueue.findIndex(u => u.id === attacker.id);
    if (attackerIndex !== -1) {
      G.actionQueue.splice(attackerIndex, 1);
    }
    G.processedUnits.add(attacker.id);
    
    recalculateActionOrder();
    G.phase = 'player_turn';
    G.currentActingUnit = null;
    G.selectedUnit = null;
    G.selectedSkill = null;
    updateUI();
    
    if (G.actionQueue.length === 0) {
      endTurn();
    } else {
      setTimeout(() => processNextAction(), 500);
    }
  };

  modal.classList.add('show');
}

function createFusionUnit(components, originalAttacker) {
  try {
    if (components.length < 2) {
      addLog('合体失败：至少需要2个单位', 'system');
      return false;
    }

    const snapshots = components.map(u => ({
      unitId: u.id,
      snapshot: clone(u)
    }));

    const count = components.length;

    let sumAtk = 0, sumMatk = 0, sumDef = 0, sumSpd = 0;
    let sumHpMax = 0, sumMpMax = 0;
    components.forEach(u => {
      sumAtk += (u.atk?.base || 0);
      sumMatk += (u.matk || 0);
      sumDef += (u.def || 0);
      sumSpd += (u.spd || 0);
      sumHpMax += (u.hp?.max || 0);
      sumMpMax += (u.mp?.max || 0);
    });
    const newAtk = Math.floor(sumAtk / count * 1.5);
    const newMatk = Math.floor(sumMatk / count * 1.5);
    const newDef = Math.floor(sumDef / count * 1.5);
    const newSpd = Math.floor(sumSpd / count * 1.5);
    const newHpMax = Math.floor(sumHpMax / count * 1.5);
    const newMpMax = Math.floor(sumMpMax / count * 1.5);

    let sumCon = 0, sumInt = 0, sumAgi = 0;
    components.forEach(u => {
      sumCon += (u.stats?.constitution || 5);
      sumInt += (u.stats?.intelligence || 5);
      sumAgi += (u.stats?.agility || 5);
    });
    const newCon = Math.floor(sumCon / count * 1.5);
    const newInt = Math.floor(sumInt / count * 1.5);
    const newAgi = Math.floor(sumAgi / count * 1.5);

    const skillMap = new Map();
    components.forEach(u => {
      const equipped = u.equippedSkills || [];
      equipped.forEach(s => {
        if (!skillMap.has(s.name)) skillMap.set(s.name, clone(s));
      });
    });
    let allSkills = Array.from(skillMap.values());
    if (allSkills.length === 0) {
      components.forEach(u => {
        const skills = u.skills || [];
        skills.forEach(s => {
          if (!skillMap.has(s.name)) skillMap.set(s.name, clone(s));
        });
      });
      allSkills = Array.from(skillMap.values());
    }

    const dissolveSkill = {
      name: "解除合体",
      type: "dissolve",
      targetType: "self",
      actionType: "non_attack",
      cost: { hp: 0, mp: 0 },
      description: "解散合体，所有原单位恢复并将在下一回合重新行动",
      customLogs: ["{attacker}解除了合体，光芒四散"]
    };
    allSkills.push(dissolveSkill);

    const mergedBuffs = [];
    const mergedDebuffs = [];
    const mergedAC = [];
    components.forEach(u => {
      mergedBuffs.push(...(u.buffs || []));
      mergedDebuffs.push(...(u.debuffs || []));
      mergedAC.push(...(u.ac || []));
    });

    const fusionUnit = {
      id: `fusion_${Date.now()}_${Math.random()}`,
      name: components.map(u => u.name).join('+') + '的合体',
      side: 'player',
      isFused: true,
      fusionComponents: components,
      preFusionSnapshots: snapshots,
      fusionActionRemaining: count,
      battleLevel: Math.max(...components.map(u => u.battleLevel)),

      atk: { base: newAtk },
      matk: newMatk,
      def: newDef,
      spd: newSpd,
      hp: { current: newHpMax, max: newHpMax },
      mp: { current: newMpMax, max: newMpMax },

      stats: { constitution: newCon, intelligence: newInt, agility: newAgi },

      pleasure: { 
        current: Math.floor(components.reduce((sum, u) => sum + u.pleasure.current, 0) / count),
        max: Math.floor(components.reduce((sum, u) => sum + u.pleasure.max, 0) / count),
        damageBonus: 0 
      },
      clothingIntegrity: Math.floor(components.reduce((sum, u) => sum + (u.clothingIntegrity || 100), 0) / count),
      ac: mergedAC,
      buffs: mergedBuffs,
      debuffs: mergedDebuffs,
      skills: allSkills,
      learnedSkills: allSkills,
      equippedSkills: allSkills,
      isStunned: components.some(u => u.isStunned),
      isTaunting: components.some(u => u.isTaunting),
      isRestrained: components.some(u => u.isRestrained),
      restraint: Math.max(...components.map(u => u.restraint || 0)),
      consciousnessSystem: null,
      actionDistance: 0,
      nextActionPoint: 0,
      skillCooldowns: {},
      freeAttributePoints: 0,
      exp: components.reduce((sum, u) => sum + (u.exp || 0), 0),
      specialEnergy: {},
      specialEnergyMax: {},
      portraitUrl: components.find(u => u.portraitUrl)?.portraitUrl || null,
      _originalPortraitUrl: components.find(u => u.portraitUrl)?.portraitUrl || null
    };

    components.forEach(u => {
      if (u.specialEnergyMax) {
        Object.entries(u.specialEnergyMax).forEach(([type, max]) => {
          if (!fusionUnit.specialEnergyMax[type] || fusionUnit.specialEnergyMax[type] < max) {
            fusionUnit.specialEnergyMax[type] = max;
          }
        });
      }
    });
    Object.keys(fusionUnit.specialEnergyMax).forEach(type => {
      fusionUnit.specialEnergy[type] = { current: 0, max: fusionUnit.specialEnergyMax[type] };
    });

    fusionUnit.hp.current = Math.min(fusionUnit.hp.current, fusionUnit.hp.max);
    fusionUnit.mp.current = Math.min(fusionUnit.mp.current, fusionUnit.mp.max);

    components.forEach(u => {
      const idx = G.playerUnits.findIndex(p => p.id === u.id);
      if (idx !== -1) G.playerUnits.splice(idx, 1);
    });
    G.playerUnits.push(fusionUnit);
    G.fusionUnits.push(fusionUnit);

    addLog(`${fusionUnit.name} 合体诞生！`, 'system');
    updateUI();
    return true;
  } catch (error) {
    console.error('合体创建失败:', error);
    addLog(`合体失败：${error.message}`, 'system');
    return false;
  }
}

function performDissolveFusion(fusionUnit) {
  if (!fusionUnit.isFused) return;

  const snapshots = fusionUnit.preFusionSnapshots;
  if (!snapshots || snapshots.length === 0) {
    addLog('合体单位数据异常，无法解除', 'system');
    return;
  }

  const idx = G.playerUnits.findIndex(u => u.id === fusionUnit.id);
  if (idx !== -1) G.playerUnits.splice(idx, 1);
  const fidx = G.fusionUnits.findIndex(f => f.id === fusionUnit.id);
  if (fidx !== -1) G.fusionUnits.splice(fidx, 1);

  snapshots.forEach(({ unitId, snapshot }) => {
    const restored = clone(snapshot);
    restored.id = unitId;
    restored.side = 'player';
    restored.isFused = false;
    delete restored.fusionComponents;
    delete restored.preFusionSnapshots;
    delete restored.fusionActionRemaining;

    G.processedUnits.add(restored.id);

    updateHPMPOnStatChange(restored);
    updatePleasureBonus(restored);

    G.playerUnits.push(restored);
  });

  if (G.actionQueue.length > 0 && G.actionQueue[0] === fusionUnit) {
    G.actionQueue.shift();
  }
  G.processedUnits.add(fusionUnit.id);

  recalculateActionOrder();

  updateUI();
  addLog(`${fusionUnit.name} 主动解除合体，原单位将在下一回合重新行动`, 'system');

  if (G.actionQueue.length === 0) {
    endTurn();
  } else if (G.phase === 'player_turn' && G.currentActingUnit === fusionUnit) {
    G.currentActingUnit = null;
    processNextAction();
  }
}

function showAOEConfirmModal(attacker, skill) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.style.zIndex = '2001';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  
  const actualCost = calculateActionCost(attacker, skill);
  const baseCost = getBaseActionCost(attacker);
  const costDiff = actualCost - baseCost;
  const costText = costDiff < 0 ? `减少 ${-costDiff}` : (costDiff > 0 ? `增加 ${costDiff}` : '不变');
  
  const targets = getValidTargets(attacker, skill);
  const targetNames = targets.map(t => t.name).join('、');
  const targetTypeText = skill.targetType === 'all_enemies' ? '全体敌人' : '全体友方';
  
  const damagePreview = getDamagePreviewText(attacker, null, skill, true);

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px; text-align: center; animation: modal-appear 0.2s ease;">
      <h2 class="modal-title">确认使用全体技能</h2>
      <div style="margin: 15px 0;">
        <p><strong>${attacker.name}</strong> 对 <strong>${targetTypeText}</strong> 使用</p>
        <p style="font-size: 1.2em; color: var(--primary-600);">【${skill.name}】</p>
        <p style="font-size: 0.8em; color: #666;">${skill.description || '无描述'}</p>
        <p style="font-size: 0.75em; color: #888;">目标: ${targetNames}</p>
        <hr>
        <div style="text-align: left; font-size: 0.8em;">
          ${damagePreview ? `<div style="margin-bottom: 8px; padding: 5px; background: rgba(124,77,202,0.1); border-radius: 4px;">${damagePreview}</div>` : ''}
          <div>💰 消耗: ${skill.cost?.mp > 0 ? `MP ${skill.cost.mp}` : ''} ${skill.cost?.hp > 0 ? `HP ${skill.cost.hp}` : ''} ${(!skill.cost || (skill.cost.mp === 0 && skill.cost.hp === 0)) ? '无消耗' : ''}</div>
          <div>⏱️ 行动消耗: ${baseCost} → ${actualCost} (${costText})</div>
        </div>
      </div>
      <div style="display: flex; gap: 10px; justify-content: center;">
        <button class="gem-button" id="confirm-aoe-use">确认使用</button>
        <button class="gem-button secondary" id="cancel-aoe-use">取消</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  const confirmBtn = modal.querySelector('#confirm-aoe-use');
  const cancelBtn = modal.querySelector('#cancel-aoe-use');
  
  confirmBtn.onclick = () => {
    modal.remove();
    executeAOESkill(attacker, skill);
    
    if (attacker.isFused) {
      attacker.fusionActionRemaining--;
      if (attacker.fusionActionRemaining > 0) {
        addLog(`${attacker.name} 还可以行动 ${attacker.fusionActionRemaining} 次`, 'system');
        recalculateActionOrder();
        setTimeout(() => processNextAction(), 100);
        return;
      }
    }
    
    recalculateActionOrder();
    G.phase = 'player_turn';
    G.currentActingUnit = null;
    G.selectedSkill = null;
    G.selectedUnit = null;
    updateUI();
    if (checkBattleEnd()) return;
    if (G.actionQueue.length === 0) endTurn();
    else setTimeout(() => processNextAction(), 500);
  };
  
  cancelBtn.onclick = () => {
    modal.remove();
    showSkillModal(attacker);
  };
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
      showSkillModal(attacker);
    }
  };
}

function highlightCurrentUnit(unit) {
  document.querySelectorAll('.unit-card').forEach(card => card.classList.remove('current'));
  const wrapper = document.getElementById(`unit-wrapper-${unit.id}`);
  if (wrapper) {
    const card = wrapper.querySelector('.unit-card');
    if (card) card.classList.add('current');
  }
}

function renderActionSimulation(overrideInfo = null) {
  const container = document.getElementById('action-order-bar');
  if (!container) return;
  
  const actions = simulateFutureActions(16, overrideInfo);
  const turnStartIndices = [];
  let lastTurn = null;
  for (let i = 0; i < actions.length; i++) {
    if (actions[i].turn !== lastTurn) {
      turnStartIndices.push(i);
      lastTurn = actions[i].turn;
    }
  }
  
  let html = `
    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 5px;">
      <span style="font-family: var(--font-display); font-weight: bold; color: var(--primary-700);">⚡行动顺序</span>
      <span style="font-size: 0.7em; color: var(--neutral-600);"> ⚑ 回合首动</span>
    </div>
    <div class="action-track" style="position: relative; margin-top: 5px; height: 32px;">
  `;
  
  if (actions.length === 0) {
    html += `<div style="text-align:center; color:#999;">无法预演（无存活单位）</div>`;
  } else {
    const stepWidth = 100 / actions.length;
    actions.forEach((act, idx) => {
      const leftPercent = idx * stepWidth + stepWidth/2;
      const markerClass = `track-marker ${act.unitId.startsWith('e_') ? 'enemy-side' : 'player-side'}`;
      const isCurrentTurn = (act.turn === G.turn);
      const isTurnStart = turnStartIndices.includes(idx);
      
      const flagIcon = isTurnStart ? `<span style="position: absolute; top: -22px; left: 50%; transform: translateX(-50%); font-size: 14px;">⚑</span>` : '';
      
      html += `
        <div class="${markerClass}" style="left: ${leftPercent}%; top: 50%; transform: translate(-50%, -50%); position: absolute; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;"
             title="第${act.turn}回合 | ${act.unitName} | AP ${act.apBefore} → ${act.apAfter}">
          ${act.unitName.charAt(0)}
          ${flagIcon}
          ${isCurrentTurn ? '<span style="position: absolute; bottom: -18px; left: 50%; transform: translateX(-50%); font-size: 10px; color: var(--primary-500);">●</span>' : ''}
        </div>
      `;
    });
  }
  
  html += `<div class="track-finish-line"></div></div>`;
  
  html += `<div class="action-queue-text" style="margin-top: 8px; font-size: 0.7em; color: var(--neutral-600); line-height: 1.5;">`;
  let lastTurnText = null;
  actions.forEach((act, idx) => {
    if (lastTurnText !== null && act.turn !== lastTurnText) {
      html += ` <span style="background: var(--primary-200); padding: 0px 4px; border-radius: 10px; margin: 0 4px;">▶ T${act.turn} ◀</span> `;
    }
    html += `${idx+1}. ${act.unitName}`;
    if (idx < actions.length-1) html += ' → ';
    lastTurnText = act.turn;
  });
  html += `</div>`;
  
  container.innerHTML = html;
}

function updateActionOrderBar(overrideInfo = null) {
  renderActionSimulation(overrideInfo);
}

function renderUnitList(containerId, units) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const fragment = document.createDocumentFragment();
  units.forEach(unit => fragment.appendChild(renderUnitCard(unit)));
  container.replaceChildren(fragment);
}
function updateUI() {
  renderUnitList('player-units', G.playerUnits);
  renderUnitList('enemy-units', G.enemyUnits);
  
  updateActionOrderBar();
  updateLogDisplay();
  
  const statsButton = document.getElementById('btn-show-all-stats');
  if (statsButton) {
    if (G.phase === 'player_turn' || G.phase === 'enemy_turn' || G.phase === 'waiting_player_action') {
      statsButton.style.display = 'flex';
    } else if (G.phase === 'init') {
      statsButton.style.display = 'none';
    }
  }
}

function addLog(message, type = 'system') {
  if (!G.logFilters[type]) return;
  // 可选：去掉内部提示类消息（通过关键词过滤）
  const ignoreKeywords = [];
  for (let kw of ignoreKeywords) {
    if (message.includes(kw)) return;
  }
  G.log.push({ message, type, turn: G.turn });
  updateLogDisplay();
}

function renderLogEntries() {
  return G.log.map(entry =>
    `<div class="log-entry ${entry.type}">[回合${entry.turn}] ${escapeHtml(entry.message)}</div>`
  ).join('');;
}

function updateLogDisplay() {
  const logContent = document.getElementById('log-content');
  if (!logContent) return;
  
  logContent.innerHTML = renderLogEntries();
  logContent.scrollTop = logContent.scrollHeight;
  
  const logModal = document.getElementById('log-modal');
  if (logModal && logModal.classList.contains('show')) {
    updateLogModalContent();
  }
}
function updateLogModalContent() {
  const modalBody = document.getElementById('log-modal-body');
  if (!modalBody) return;
  
  const logHtml = renderLogEntries();
  
  modalBody.innerHTML = logHtml || '<div style="text-align:center; color:#999; padding:40px;">暂无日志记录</div>';
  modalBody.scrollTop = modalBody.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showLogModal() {
  const modal = document.getElementById('log-modal');
  if (!modal) return;
  
  updateLogModalContent();
  modal.classList.add('show');
}

function closeLogModal() {
  const modal = document.getElementById('log-modal');
  if (modal) {
    modal.classList.remove('show');
  }
}

async function copyLogToClipboard() {
  if (G.log.length === 0) {
    addLog('没有日志可复制', 'system');
    return;
  }
  
  const filterKeywords = [
    '还有剩余行动次数，请继续选择技能',
    '战报提示词已复制到剪贴板'
  ];
  
  const logText = G.log
    .filter(entry => {
      const cleanMessage = entry.message.replace(/<[^>]*>/g, '');
      return !filterKeywords.some(keyword => cleanMessage.includes(keyword));
    })
    .map(entry => `[回合${entry.turn}] ${entry.message.replace(/<[^>]*>/g, '')}`)
    .join('\n');
  
  try {
    await navigator.clipboard.writeText(logText);
    
    const copyBtn = document.getElementById('btn-copy-log');
    if (copyBtn) {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = '✓ 已复制!';
      copyBtn.disabled = true;
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.disabled = false;
      }, 2000);
    }
    addLog('日志已复制到剪贴板', 'system');
  } catch (err) {
    console.error('复制失败:', err);
    addLog('复制日志失败', 'system');
  }
}

function showFloat(unit, text, type = 'damage') {
  const wrapper = document.getElementById(`unit-wrapper-${unit.id}`);
  if (!wrapper) return;
  const card = wrapper.querySelector('.unit-card');
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const float = document.createElement('div');
  float.className = `floating-text ${type}`;
  float.textContent = text;
  float.style.left = `${rect.left + rect.width / 2}px`;
  float.style.top = `${rect.top}px`;
  document.body.appendChild(float);
  setTimeout(() => float.remove(), 1500);
}

let manageState = {
  selectedUnit: null,
  tempStats: null,
  tempFreePoints: 0,
  tempEquippedSkills: [],
  originalUnit: null
};

function showCharacterManageModal() {
  const modal = document.getElementById('character-manage-modal');
  const list = document.getElementById('manage-character-list');
  const detail = document.getElementById('manage-detail-panel');
  list.innerHTML = '';
  detail.innerHTML = '<p style="color:#999; text-align:center; padding:40px;">请选择角色</p>';
  manageState = { selectedUnit: null, tempStats: null, tempFreePoints: 0, tempEquippedSkills: [], originalUnit: null };
  
  // ========== 从 MVU 读取等级并覆盖 window.loadedPlayers ==========
  let mvuStatData = {};
  try {
    const mvuVariables = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
    mvuStatData = _.get(mvuVariables, 'stat_data') || {};
} catch (e) {
    console.warn('读取 MVU 数据失败，将使用模板默认等级', e);
}

window.loadedPlayers.forEach(unit => {
    const found = findMvuEntity(mvuStatData, unit.name);
    if (!found) return;
    const lv = _.get(found.entity, '角色信息.等级与经验.当前等级');
    if (lv !== undefined && lv !== null && lv > 0) unit.battleLevel = lv;
});

  window.loadedPlayers.forEach(unit => {
    const card = document.createElement('div');
    card.style.cssText = 'padding:10px; background:white; border:2px solid var(--neutral-300); border-radius:8px; cursor:pointer;';
    card.innerHTML = `
      <div style="font-weight:bold;">${unit.name}</div>
      <div style="font-size:0.75em;">Lv.${unit.battleLevel} | 未分配属性点: ${unit.freeAttributePoints || 0}</div>
    `;
    card.onclick = () => selectManageCharacter(unit);
    list.appendChild(card);
  });
  modal.classList.add('show');
}

function selectManageCharacter(unit) {
    manageState.selectedUnit = unit;
    manageState.originalUnit = JSON.parse(JSON.stringify(unit));
    
    const originalUnit = window.loadedPlayers.find(p => p.id === unit.id || p.name === unit.name);
    let baseStats;
    if (originalUnit && originalUnit.stats) {
        baseStats = { ...originalUnit.stats };
    } else {
        baseStats = { ...(unit.stats || { constitution: 5, intelligence: 5, agility: 5 }) };
    }
    
    manageState.baseStats = baseStats;
    manageState.tempStats = { ...baseStats };
    manageState.tempFreePoints = unit.freeAttributePoints || 0;
    manageState.tempHP = unit.hp.current;
    manageState.tempMP = unit.mp.current;
    manageState.tempClothing = unit.clothingIntegrity !== undefined ? unit.clothingIntegrity : 100;
    manageState.tempEquippedSkills = (unit.equippedSkills || []).map(s => {
        if (typeof s === 'string') return { name: s };
        return s;
    });
    
    manageState.tempRaceBases = {
        constitution: unit.种族值?.$体质种族值固定值 || 0,
        intelligence: unit.种族值?.$智力种族值固定值 || 0,
        defense: unit.种族值?.$防御种族值固定值 || 0,
        agility: unit.种族值?.$敏捷种族值固定值 || 0
    };
    manageState.tempRaceBonuses = {
        constitution: unit.种族值?.体质种族值加值 || 0,
        intelligence: unit.种族值?.智力种族值加值 || 0,
        defense: unit.种族值?.防御种族值加值 || 0,
        agility: unit.种族值?.敏捷种族值加值 || 0
    };
    
    renderManageDetail();
}

function renderManageDetail() {
  const panel = document.getElementById('manage-detail-panel');
  const unit = manageState.selectedUnit;
  const stats = manageState.tempStats;
  const free = manageState.tempFreePoints;
  const tempUnit = {
    ...unit,
    stats: stats,
    buffs: [],
    debuffs: []
  };
  const maxHP = calculateMaxHP(tempUnit);
  const maxMP = calculateMaxMP(tempUnit);
  const baseATK = calculateBaseATK(tempUnit);
  const spd = unit.spd || 0;
  const actionCost = Math.floor(10000 / (spd + 100));
  const maxActions = Math.floor(100 / actionCost);
  
  // 获取当前 HP 和 MP
  const currentHP = manageState.tempHP !== undefined ? manageState.tempHP : unit.hp.current;
  const currentMP = manageState.tempMP !== undefined ? manageState.tempMP : unit.mp.current;
  
  let html = `
    <h3>${unit.name} <span style="font-size:0.7em;">Lv.${unit.battleLevel}</span></h3>
    <p>未分配属性点: <strong>${free}</strong></p>
    
    <!-- ===== HP/MP 修改区域 ===== -->
    <div style="margin: 15px 0; padding: 12px; background: var(--primary-50); border-radius: 8px; border: 1px solid var(--primary-200);">
      <div style="font-weight: bold; margin-bottom: 10px; color: var(--primary-700);">💚 生命值与法力值</div>
      
      <!-- HP 修改 -->
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
        <span style="min-width: 60px; font-weight: bold;">HP:</span>
        <input type="number" id="manage-hp-input" value="${currentHP}" min="1" max="${maxHP}" 
               style="width: 80px; padding: 4px 8px; border: 1px solid var(--neutral-300); border-radius: 4px;">
        <span style="color: var(--neutral-500);">/ ${maxHP}</span>
        <button id="btn-full-hp" class="gem-button" style="padding: 4px 12px; font-size: 0.7em;">全部恢复</button>
      </div>
      
      <!-- MP 修改 -->
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="min-width: 60px; font-weight: bold;">MP:</span>
        <input type="number" id="manage-mp-input" value="${currentMP}" min="0" max="${maxMP}" 
               style="width: 80px; padding: 4px 8px; border: 1px solid var(--neutral-300); border-radius: 4px;">
        <span style="color: var(--neutral-500);">/ ${maxMP}</span>
        <button id="btn-full-mp" class="gem-button" style="padding: 4px 12px; font-size: 0.7em;">全部恢复</button>
      </div>
    </div>

<div style="margin: 15px 0; padding: 12px; background: var(--primary-50); border-radius: 8px; border: 1px solid var(--primary-200);">
  <div style="font-weight: bold; margin-bottom: 10px; color: var(--primary-700);">👗 服装耐久度</div>
  
  <div style="display: flex; align-items: center; gap: 10px;">
    <span style="min-width: 60px; font-weight: bold;">服装:</span>
    <input type="number" id="manage-clothing-input" value="${unit.clothingIntegrity !== undefined ? unit.clothingIntegrity : 100}" min="0" max="100" 
           style="width: 80px; padding: 4px 8px; border: 1px solid var(--neutral-300); border-radius: 4px;">
    <span style="color: var(--neutral-500);">/ 100%</span>
    <button id="btn-full-clothing" class="gem-button" style="padding: 4px 12px; font-size: 0.7em;">全部修复</button>
    <button id="btn-zero-clothing" class="gem-button danger" style="padding: 4px 12px; font-size: 0.7em;">完全破坏</button>
  </div>
  <div style="font-size: 0.7em; color: var(--neutral-500); margin-top: 5px;">
    💡 服装耐久度影响敌方是否会使用色色技能攻击该角色
  </div>
</div>
    
    <!-- 属性加点区域 -->
<div style="margin:10px 0;">
  <div style="display:flex; align-items:center; gap:10px; margin:5px 0;">
    <span>体质: ${(manageState.tempRaceBases?.constitution || 0) + (manageState.tempRaceBonuses?.constitution || 0)}</span>
    ${free > 0 ? `<button class="gem-button" style="padding:2px 8px; font-size:0.7em;" onclick="allocatePoint('constitution')">+</button>` : ''}
  </div>
  <div style="display:flex; align-items:center; gap:10px; margin:5px 0;">
    <span>智力: ${(manageState.tempRaceBases?.intelligence || 0) + (manageState.tempRaceBonuses?.intelligence || 0)}</span>
    ${free > 0 ? `<button class="gem-button" style="padding:2px 8px; font-size:0.7em;" onclick="allocatePoint('intelligence')">+</button>` : ''}
  </div>
  <div style="display:flex; align-items:center; gap:10px; margin:5px 0;">
    <span>敏捷: ${(manageState.tempRaceBases?.agility || 0) + (manageState.tempRaceBonuses?.agility || 0)}</span>
    ${free > 0 ? `<button class="gem-button" style="padding:2px 8px; font-size:0.7em;" onclick="allocatePoint('agility')">+</button>` : ''}
  </div>
  <div style="display:flex; align-items:center; gap:10px; margin:5px 0;">
    <span>防御: ${(manageState.tempRaceBases?.defense || 0) + (manageState.tempRaceBonuses?.defense || 0)}</span>
    ${free > 0 ? `<button class="gem-button" style="padding:2px 8px; font-size:0.7em;" onclick="allocatePoint('defense')">+</button>` : ''}
  </div>
</div>    

    <div style="font-size:0.75em; color:#666; margin:5px 0;">
      派生属性: HP上限 ${maxHP} | MP上限 ${maxMP} | 行动消耗 ${actionCost} | 行动次数 ${maxActions}
    </div>
    <hr>
    <h4>当前使用技能池 (${manageState.tempEquippedSkills.length}/6)</h4>
    <div id="manage-equipped-skills" style="display:flex; flex-wrap:wrap; gap:4px; min-height:30px;"></div>
    <h4 style="margin-top:10px;">可使用技能池</h4>
    <div id="manage-learned-skills" style="display:flex; flex-wrap:wrap; gap:4px; max-height:200px; overflow-y:auto; min-height:30px;"></div>
  `;
  panel.innerHTML = html;
  
  // 绑定 HP/MP 修改事件
  const hpInput = document.getElementById('manage-hp-input');
  const mpInput = document.getElementById('manage-mp-input');
  const btnFullHp = document.getElementById('btn-full-hp');
  const btnFullMp = document.getElementById('btn-full-mp');
  
  if (hpInput) {
    hpInput.addEventListener('change', function() {
      let newValue = parseInt(this.value);
      if (isNaN(newValue)) newValue = unit.hp.current;
      newValue = Math.max(1, Math.min(maxHP, newValue));
      manageState.tempHP = newValue;
      this.value = newValue;
    });
  }
  
  if (mpInput) {
    mpInput.addEventListener('change', function() {
      let newValue = parseInt(this.value);
      if (isNaN(newValue)) newValue = unit.mp.current;
      newValue = Math.max(0, Math.min(maxMP, newValue));
      manageState.tempMP = newValue;
      this.value = newValue;
    });
  }
  
  if (btnFullHp) {
    btnFullHp.onclick = () => {
      manageState.tempHP = maxHP;
      const input = document.getElementById('manage-hp-input');
      if (input) input.value = maxHP;
    };
  }
  
  if (btnFullMp) {
    btnFullMp.onclick = () => {
      manageState.tempMP = maxMP;
      const input = document.getElementById('manage-mp-input');
      if (input) input.value = maxMP;
    };
  }

const clothingInput = document.getElementById('manage-clothing-input');
const btnFullClothing = document.getElementById('btn-full-clothing');
const btnZeroClothing = document.getElementById('btn-zero-clothing');

if (clothingInput) {
  clothingInput.addEventListener('change', function() {
    let newValue = parseInt(this.value);
    if (isNaN(newValue)) newValue = unit.clothingIntegrity !== undefined ? unit.clothingIntegrity : 100;
    newValue = Math.max(0, Math.min(100, newValue));
    manageState.tempClothing = newValue;
    this.value = newValue;
  });
}

if (btnFullClothing) {
  btnFullClothing.onclick = () => {
    manageState.tempClothing = 100;
    const input = document.getElementById('manage-clothing-input');
    if (input) input.value = 100;
  };
}

if (btnZeroClothing) {
  btnZeroClothing.onclick = () => {
    if (confirm('确定要完全破坏该角色的服装吗？')) {
      manageState.tempClothing = 0;
      const input = document.getElementById('manage-clothing-input');
      if (input) input.value = 0;
    }
  };
}
  
  renderManageSkills();
}

function allocatePoint(stat) {
    if (manageState.tempFreePoints > 0) {
        if (!manageState.tempRaceBonuses) {
            manageState.tempRaceBonuses = {
                constitution: manageState.selectedUnit?.种族值?.体质种族值加值 || 0,
                intelligence: manageState.selectedUnit?.种族值?.智力种族值加值 || 0,
                defense: manageState.selectedUnit?.种族值?.防御种族值加值 || 0,
                agility: manageState.selectedUnit?.种族值?.敏捷种族值加值 || 0
            };
        }
        if (stat === 'constitution') manageState.tempRaceBonuses.constitution++;
        else if (stat === 'intelligence') manageState.tempRaceBonuses.intelligence++;
        else if (stat === 'defense') manageState.tempRaceBonuses.defense++;
        else if (stat === 'agility') manageState.tempRaceBonuses.agility++;
        manageState.tempFreePoints--;
        renderManageDetail();
    }
}

function renderManageSkills() {
  const unit = manageState.selectedUnit;
    let learnedSkills = unit.learnedSkills && unit.learnedSkills.length > 0 ? unit.learnedSkills : (unit.skills || []);
  learnedSkills = learnedSkills.map(skill => {
    if (typeof skill === 'string') {
      const resolved = getSkillFromWorldbook(skill);
      return resolved || { name: skill, requiredLevel: 0 };
    }
    return skill;
  });
  const equipped = manageState.tempEquippedSkills;
  const equippedDiv = document.getElementById('manage-equipped-skills');
  const learnedDiv = document.getElementById('manage-learned-skills');
  if (!equippedDiv || !learnedDiv) return;
  
  equippedDiv.innerHTML = '';
  equipped.forEach(skill => {
    const skillName = skill.name || (typeof skill === 'string' ? skill : '未知技能');
    const tag = document.createElement('span');
    tag.className = 'manage-skill-tag equipped';
    tag.textContent = skillName + ' ✕';
    tag.onclick = () => {
      manageState.tempEquippedSkills = manageState.tempEquippedSkills.filter(s => {
        const sn = s.name || (typeof s === 'string' ? s : '');
        return sn !== skillName;
      });
      renderManageSkills();
    };
    equippedDiv.appendChild(tag);
  });
  
  learnedDiv.innerHTML = '';
  learnedSkills.forEach(skill => {
    const skillName = skill.name || (typeof skill === 'string' ? skill : '未知技能');
    const isEquipped = equipped.some(s => {
      const sn = s.name || (typeof s === 'string' ? s : '');
      return sn === skillName;
    });
    const skillLevelSufficient = canUseSkill(unit, skill);
    const skillReqLevel = getSkillRequiredLevel(skill);
    const tag = document.createElement('span');
    if (isEquipped) {
      tag.className = 'manage-skill-tag already-equipped';
      tag.textContent = skillName + ' (已装备)';
      tag.onclick = null;
    } else {
      tag.className = 'manage-skill-tag available';
      if (skillReqLevel > 0 && !skillLevelSufficient) {
        tag.textContent = skillName + ` + (需要Lv.${skillReqLevel})`;
        tag.style.color = '#c49a3c';
      } else {
        tag.textContent = skillName + ' +';
      }      
      tag.onclick = () => {
        if (manageState.tempEquippedSkills.length >= 6) {
          alert('技能槽已满 (6/6)，请先移除一个技能');
          return;
        }
        if (skillReqLevel > 0 && !skillLevelSufficient) {
          if (!confirm(`${skillName} 需要Lv.${skillReqLevel}才能使用，当前等级Lv.${unit.battleLevel}。\n可以装备但战斗中无法使用，确定装备吗？`)) {
            return;
          }
        }
        manageState.tempEquippedSkills.push(skill);        renderManageSkills();
      };
    }
    learnedDiv.appendChild(tag);
  });
}

document.getElementById('btn-confirm-manage').onclick = async () => {
    const unit = manageState.selectedUnit;
    if (!unit) return;
  
    unit.stats = { ...manageState.tempStats };
    unit.freeAttributePoints = manageState.tempFreePoints;
    unit.equippedSkills = [...manageState.tempEquippedSkills];
  
    if (manageState.tempHP !== undefined) unit.hp.current = manageState.tempHP;
    if (manageState.tempMP !== undefined) unit.mp.current = manageState.tempMP;
    if (manageState.tempClothing !== undefined) unit.clothingIntegrity = manageState.tempClothing;
  
    if (manageState.tempRaceBonuses) {
        if (!unit.种族值) unit.种族值 = {};
        unit.种族值.体质种族值加值 = manageState.tempRaceBonuses.constitution;
        unit.种族值.智力种族值加值 = manageState.tempRaceBonuses.intelligence;
        unit.种族值.防御种族值加值 = manageState.tempRaceBonuses.defense;
        unit.种族值.敏捷种族值加值 = manageState.tempRaceBonuses.agility;
    }
  
    if (!unit.learnedSkills || unit.learnedSkills.length === 0) {
        unit.learnedSkills = [...(unit.skills || [])];
    }
  
    const tempUnit = { ...unit, buffs: [], debuffs: [] };
    unit.hp.max = calculateMaxHP(tempUnit);
    unit.hp.current = Math.min(unit.hp.current, unit.hp.max);
    unit.mp.max = calculateMaxMP(tempUnit);
    unit.mp.current = Math.min(unit.mp.current, unit.mp.max);
    unit.atk.base = calculateBaseATK(tempUnit);
    await syncUnitToMvu(unit);
  
    document.getElementById('character-manage-modal').classList.remove('show');
    showUnitSelection();
};

document.getElementById('btn-close-manage').onclick = () => {
  document.getElementById('character-manage-modal').classList.remove('show');
};

async function showUnitSelection() {
  const grid = document.getElementById('selection-grid');
  grid.innerHTML = '';
  const selectedUnits = [];
  
  let availablePlayers = window.loadedPlayers;
  if (!availablePlayers || availablePlayers.length === 0) {
    addLog('错误: 没有可用的玩家角色数据', 'system');
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px;">没有可用的角色数据</div>';
    return;
  }
  
  const mvuPlayerNames = getAvailablePlayerNames();
  
  if (mvuPlayerNames !== null && mvuPlayerNames.size > 0) {
    availablePlayers = availablePlayers.filter(p => mvuPlayerNames.has(p.name));
    if (availablePlayers.length === 0) {
      addLog('错误: 没有匹配的玩家角色（MVU中isPresent为true的角色在玩家角色模板中不存在）', 'system');
      addLog(`MVU角色名称: [${[...mvuPlayerNames].join(', ')}]`, 'system');
      addLog(`玩家模板名称: [${window.loadedPlayers.map(p => p.name).join(', ')}]`, 'system');
      grid.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:40px; background:#fff0f0; border:2px solid #c9445a; border-radius:8px;">
          <h3 style="color:#c9445a;">错误: 没有可出战的角色</h3>
          <p style="margin:20px 0;">MVU变量中没有标记为isPresent的伙伴，或模板不匹配</p>
          <button class="gem-button" onclick="location.reload()">重试</button>
        </div>
      `;
      return;
    }
    addLog(`MVU过滤后可用玩家角色: ${availablePlayers.map(p => p.name).join(', ')}`, 'system');
  } else if (mvuPlayerNames !== null && mvuPlayerNames.size === 0) {
    addLog('错误: MVU中没有isPresent为true的伙伴角色', 'system');
    grid.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:40px; background:#fff0f0; border:2px solid #c9445a; border-radius:8px;">
        <h3 style="color:#c9445a;">错误: 没有可出战的伙伴</h3>
        <p style="margin:20px 0;">MVU变量中没有标记为isPresent的伙伴</p>
        <button class="gem-button" onclick="location.reload()">重试</button>
      </div>
    `;
    return;
  }
  
  if (worldbookData.skills) {
    availablePlayers = resolveSkills(availablePlayers, worldbookData.skills);
  }

  // ========== 新增：从 MVU 读取等级并覆盖 battleLevel ==========
  let mvuStatData = {};
  try {
    // 获取当前楼层的 MVU 数据（与 startBattle 中一致）
    if (typeof Mvu !== 'undefined' && typeof Mvu.getMvuData === 'function') {
      const mvuVariables = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
      mvuStatData = _.get(mvuVariables, 'stat_data') || {};
    }
  } catch (e) {
    console.warn('读取 MVU 数据失败，将使用模板默认等级', e);
  }

  availablePlayers.forEach(unit => {
    const found = findMvuEntity(mvuStatData, unit.name);
    if (!found) return;
    const lv = _.get(found.entity, '角色信息.等级与经验.当前等级');
    if (lv !== undefined && lv !== null && lv > 0) unit.battleLevel = lv;
  });

  // ============================================================
  
  availablePlayers.forEach(unit => {
    const safeUnit = {
      ...unit,
      skills: unit.skills || [],
      learnedSkills: unit.learnedSkills || unit.skills || [],
      equippedSkills: unit.equippedSkills || [],
      ac: unit.ac || [],
      buffs: unit.buffs || [],
      debuffs: unit.debuffs || [],
      pleasure: unit.pleasure || { current: 0, max: 100, damageBonus: 0 },
      isStunned: unit.isStunned || false,
      isTaunting: unit.isTaunting || false,
      hp: unit.hp || { current: 100, max: 100 },
      mp: unit.mp || { current: 50, max: 50 },
      atk: unit.atk || { base: 10 },
      stats: unit.stats || { constitution: 5, intelligence: 5, agility: 5 },
      freeAttributePoints: unit.freeAttributePoints || 0,
      battleLevel: unit.battleLevel || 1,
      exp: unit.exp || 0
    };
const tempCalcUnit = {
  ...safeUnit,
  buffs: [],
  debuffs: []
};
safeUnit.hp.max = calculateMaxHP(tempCalcUnit);
safeUnit.mp.max = calculateMaxMP(tempCalcUnit);
if (safeUnit.hp.current > safeUnit.hp.max) safeUnit.hp.current = safeUnit.hp.max;
if (safeUnit.mp.current > safeUnit.mp.max) safeUnit.mp.current = safeUnit.mp.max;
    
    const card = document.createElement('div');
    card.className = 'selection-card';
    
    if (safeUnit.portraitUrl) {
      card.style.backgroundImage = `url('${safeUnit.portraitUrl}')`;
      card.style.backgroundColor = 'transparent';
    } else {
      card.style.backgroundColor = '#2a2638';
    }
    
    card.style.backgroundSize = 'cover';
    card.style.backgroundPosition = 'center';
    card.style.backgroundRepeat = 'no-repeat';
    
    const currentHp = safeUnit.hp.current;
    const maxHp = safeUnit.hp.max;
    const currentMp = safeUnit.mp.current;
    const maxMp = safeUnit.mp.max;
    
    card.innerHTML = `
      <div class="selection-info" style="
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(4px);
        padding: 6px 8px;
        width: 100%;
      ">
        <div style="font-weight:bold; font-size:0.9em; margin-bottom: 2px;">${safeUnit.name}</div>
        <div style="font-size:0.7em; color:#ffd700; margin-bottom: 4px;">Lv.${safeUnit.battleLevel}</div>
        <div style="margin-bottom: 3px;">
          <div style="display: flex; justify-content: space-between; font-size:0.6em;">
            <span>HP</span>
            <span>${currentHp}/${maxHp}</span>
          </div>
          <div style="width:100%; height:3px; background:rgba(0,0,0,0.4); border-radius:2px;">
            <div style="width:${(currentHp/maxHp)*100}%; height:100%; background:#c9445a; border-radius:2px;"></div>
          </div>
        </div>
        <div>
          <div style="display: flex; justify-content: space-between; font-size:0.6em;">
            <span>MP</span>
            <span>${currentMp}/${maxMp}</span>
          </div>
          <div style="width:100%; height:3px; background:rgba(0,0,0,0.4); border-radius:2px;">
            <div style="width:${(currentMp/maxMp)*100}%; height:100%; background:#5b8fbf; border-radius:2px;"></div>
          </div>
        </div>
      </div>
    `;
    
    card.style.border = '3px solid transparent';
    card.style.transition = 'border-color 0.2s ease, box-shadow 0.2s ease';
    
    if (safeUnit.hp.current <= 0) {
      card.style.opacity = '0.5';
      card.style.borderColor = 'var(--danger)';
      card.title = '该角色已脱力，无法出战';
    }
    
    card.onclick = () => {
      if (safeUnit.hp.current <= 0) {
        alert(`${safeUnit.name} 已脱力，无法出战`);
        return;
      }
      if (card.classList.contains('selected')) {
        card.classList.remove('selected');
        card.style.borderColor = 'transparent';
        card.style.boxShadow = 'none';
        const idx = selectedUnits.findIndex(u => u.id === safeUnit.id);
        if (idx > -1) selectedUnits.splice(idx, 1);
      } else {
        if (selectedUnits.length >= 4) { alert('最多选择4名单位'); return; }
        card.classList.add('selected');
        card.style.borderColor = '#3b82f6';
        card.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.3), 0 4px 12px rgba(0, 0, 0, 0.15)';
        selectedUnits.push(safeUnit);
      }
      document.getElementById('btn-start-battle').disabled = selectedUnits.length < 1;
    };
    grid.appendChild(card);
  });
  
  document.getElementById('btn-start-battle').onclick = () => {
    if (selectedUnits.length < 1) { alert('请至少选择1名角色'); return; }
    startBattle(selectedUnits);
  };
}

function applyTransformEffect(target, effect, source) {
    const stage = effect.stage || 1;
    const buffName = effect.buffName || `变身·阶段${stage}`;
    const statBonus = effect.statBonus || (stage === 1 ? 0.3 : stage === 2 ? 0.6 : 1.0);
    const newPortraitUrl = effect.portraitUrl || null;

    const existingTransform = target.buffs.find(b => b.name && b.name.startsWith('变身·阶段'));
    if (existingTransform) {
        const currentStage = parseInt(existingTransform.name.match(/阶段(\d+)/)?.[1] || 0);
        if (currentStage >= stage) {
            addLog(`${target.name} 已是更高阶段，无法再次变身`, 'system');
            return;
        }
        const index = target.buffs.indexOf(existingTransform);
        if (index > -1) target.buffs.splice(index, 1);
        addLog(`${target.name}从${existingTransform.name}进化到${buffName}！`, 'system');
    } else {
        addLog(`${target.name}使用了${buffName}！`, 'system');
    }

    if (target._originalNewStats === undefined) {
        target._originalNewStats = {
            atk: target.atk?.base || 0,
            matk: target.matk || 0,
            def: target.def || 0,
            spd: target.spd || 0,
            hpMax: target.hp?.max || 0,
            mpMax: target.mp?.max || 0
        };
        if (target.stats) {
            target._originalStats = {
                constitution: target.stats.constitution || 5,
                intelligence: target.stats.intelligence || 5,
                agility: target.stats.agility || 5
            };
        }
    }

    const orig = target._originalNewStats;
    const newAtk = Math.floor(orig.atk * (1 + statBonus));
    const newMatk = Math.floor(orig.matk * (1 + statBonus));
    const newDef = Math.floor(orig.def * (1 + statBonus));
    const newSpd = Math.floor(orig.spd * (1 + statBonus));
    const newHpMax = Math.floor(orig.hpMax * (1 + statBonus));
    const newMpMax = Math.floor(orig.mpMax * (1 + statBonus));

    target.atk.base = newAtk;
    target.matk = newMatk;
    target.def = newDef;
    target.spd = newSpd;
    target.hp.max = newHpMax;
    target.mp.max = newMpMax;

    if (orig.hpMax > 0) {
        target.hp.current = Math.min(newHpMax, Math.floor(target.hp.current * (newHpMax / orig.hpMax)));
    } else {
        target.hp.current = newHpMax;
    }
    if (orig.mpMax > 0) {
        target.mp.current = Math.min(newMpMax, Math.floor(target.mp.current * (newMpMax / orig.mpMax)));
    } else {
        target.mp.current = newMpMax;
    }

    if (target._originalStats && target.stats) {
        const oldOrig = target._originalStats;
        target.stats.constitution = Math.floor(oldOrig.constitution * (1 + statBonus));
        target.stats.intelligence = Math.floor(oldOrig.intelligence * (1 + statBonus));
        target.stats.agility = Math.floor(oldOrig.agility * (1 + statBonus));
    }

    target.buffs.push({
        name: buffName,
        description: `全属性提升${statBonus * 100}%，形态变化`,
        remainingActions: effect.duration || -1,
        type: 'buff',
        isTransform: true,
        transformStage: stage,
        transformBonus: statBonus,
        _originalNewStats: { ...orig },
        _originalStats: target._originalStats ? { ...target._originalStats } : undefined
    });

    target.transformStage = stage;
    target.transformBonus = statBonus;

    addLog(`${target.name} 全属性提升${statBonus * 100}%！HP ${target.hp.max}，MP ${target.mp.max}`, 'system');

    if (newPortraitUrl) {
        if (!target._originalPortraitUrl) {
            target._originalPortraitUrl = target.portraitUrl;
        }
        target.portraitUrl = newPortraitUrl;
        addLog(`${target.name} 的形态发生了变化！`, 'system');
    }

    target._hasExtraAction = true;
    updateUI();
}

function applyBattleStartSkills(unit) {
  if (!unit.battleStartSkills || unit.battleStartSkills.length === 0) return;

  const processedSkillNames = new Set(); 

  for (const skill of unit.battleStartSkills) {
    if (!skill) continue;
    if (normalizeActionType(skill.actionType) !== ACTION_TYPE.NON_ATTACK) continue;

    if (processedSkillNames.has(skill.name)) {
      console.warn(`${unit.name} 的技能 ${skill.name} 重复执行，已跳过`);
      continue;
    }
    processedSkillNames.add(skill.name);

    const customLog = getRandomCustomLog(skill, unit);
    if (customLog) {
      addLog(customLog, 'system');
    } else {
      addLog(`${unit.name}在战斗开始时释放了【${skill.name}】`, 'system');
    }

    let targets = [];
    switch (skill.targetType) {
      case 'self':
        targets = [unit];
        break;
      case 'all_allies':
        targets = unit.side === 'player' ? G.playerUnits : G.enemyUnits;
        targets = targets.filter(t => t.hp.current > 0);
        break;
      case 'all_enemies':
        targets = unit.side === 'player' ? G.enemyUnits : G.playerUnits;
        targets = targets.filter(t => t.hp.current > 0);
        break;
      default:
        continue;
    }

    targets.forEach(target => {
      (skill.effects || []).forEach(effect => {
        applyEffect(target, effect, unit);
      });
    });

    unit.mp.current = Math.max(0, unit.mp.current - (skill.cost?.mp || 0));
    unit.hp.current = Math.max(0, unit.hp.current - (skill.cost?.hp || 0));
  }
}

async function startBattle(selectedUnits) {
  G.fusionUnits = [];
  const toggleCheckbox = document.getElementById('toggle-enemy-special-skills');
  G.enemySpecialSkillsEnabled = toggleCheckbox ? toggleCheckbox.checked : true;
  const maleParasiteToggle = document.getElementById('toggle-male-parasite');
  const malePregnancyToggle = document.getElementById('toggle-male-pregnancy');
  const maleHypnosisToggle = document.getElementById('toggle-male-hypnosis');
  
  G.maleParasiteEnabled = maleParasiteToggle ? maleParasiteToggle.checked : true;
  G.malePregnancyEnabled = malePregnancyToggle ? malePregnancyToggle.checked : true;
  G.maleHypnosisEnabled = maleHypnosisToggle ? maleHypnosisToggle.checked : true;
  
  addLog(`男性特殊效果开关: 寄生=${G.maleParasiteEnabled}, 怀孕=${G.malePregnancyEnabled}, 催眠=${G.maleHypnosisEnabled}`, 'system');
  preBattlePlayerData = JSON.parse(JSON.stringify(selectedUnits));
  G.globalCooldowns = {};

  // ---------- 获取 MVU 数据 ----------
  let mvuStatData = {};
  try {
    const mvuVariables = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
    mvuStatData = _.get(mvuVariables, 'stat_data') || {};
  } catch (e) {
    console.warn('读取 MVU 数据失败，将使用模板默认等级', e);
  }

  G.playerUnits = selectedUnits.map(u => {
    const cloned = clone(u);
    cloned.side = 'player';
    cloned.isSummoned = false;
  if (window.loadedPlayers) {
    const template = window.loadedPlayers.find(p => p.name === cloned.name);
    if (template && template.specialEnergyMax) {
      cloned.specialEnergyMax = template.specialEnergyMax;
    }
  }
    if (cloned.specialEnergyMax && typeof cloned.specialEnergyMax === 'object') {
    cloned.specialEnergy = {};
    for (const [type, max] of Object.entries(cloned.specialEnergyMax)) {
        cloned.specialEnergy[type] = { 
            current: 0, 
            max: typeof max === 'number' ? max : 100 
        };
    }
} else {
    cloned.specialEnergy = {};
}
    cloned._originalPortraitUrl = cloned.portraitUrl;
    cloned.skillCooldowns = {};
    if (!cloned.portraitUrl && u.portraitUrl) cloned.portraitUrl = u.portraitUrl;
    if (cloned.exp === undefined) cloned.exp = 0;
    cloned.stats = cloned.stats || { constitution: 5, intelligence: 5, agility: 5 };
    cloned.freeAttributePoints = cloned.freeAttributePoints || 0;
    cloned.learnedSkills = cloned.learnedSkills || cloned.skills || [];
    cloned.equippedSkills = cloned.equippedSkills || [];
    cloned.actionDistance = 0;
    cloned.nextActionPoint = 0;
    if (cloned.ac) {
      cloned.ac.forEach(ac => { if (!ac.addTime) ac.addTime = Date.now(); });
    } else {
      cloned.ac = [];
    }
    cloned.buffs = cloned.buffs || [];
    cloned.debuffs = cloned.debuffs || [];
    cloned.pleasure = cloned.pleasure || { current: 0, max: 100, damageBonus: 0 };
    cloned.isStunned = cloned.isStunned || false;
    cloned.isTaunting = cloned.isTaunting || false;
    cloned.clothingIntegrity = cloned.clothingIntegrity !== undefined ? cloned.clothingIntegrity : 100;
    if (cloned.buffs) {
      cloned.buffs.forEach(b => { if (b.remainingActions === undefined) b.remainingActions = b.remainingTurns || 3; });
    }
    if (cloned.debuffs) {
      cloned.debuffs.forEach(d => { 
        if (d.remainingActions === undefined) {
          d.remainingActions = d.duration || d.remainingTurns || 3;
        }
      });
    }
    if (worldbookData.skills) {
      if (cloned.equippedSkills && cloned.equippedSkills.length > 0) {
        cloned.equippedSkills = cloned.equippedSkills.map(s => {
          if (typeof s === 'string') {
            return getSkillFromWorldbook(s) || { name: s, requiredLevel: 0 };
          }
          return s;
        }).filter(s => s !== null);
      }
      if (cloned.learnedSkills && cloned.learnedSkills.length > 0) {
        cloned.learnedSkills = cloned.learnedSkills.map(s => {
          if (typeof s === 'string') {
            return getSkillFromWorldbook(s) || { name: s, requiredLevel: 0 };
          }
          return s;
        }).filter(s => s !== null);
      }
      if (cloned.skills && cloned.skills.length > 0) {
        cloned.skills = cloned.skills.map(s => {
          if (typeof s === 'string') {
            return getSkillFromWorldbook(s) || { name: s };
          }
          return s;
        }).filter(s => s !== null);
      }
    }
    
    if (cloned.battleStartSkills && cloned.battleStartSkills.length > 0) {
      cloned.battleStartSkills = cloned.battleStartSkills.map(s => {
        if (typeof s === 'string') {
          const skillObj = getSkillFromWorldbook(s);
          if (!skillObj) {
            return {
              name: s,
              type: "skill",
              targetType: "self",
              actionType: "non-attack",
              cost: { hp: 0, mp: 0 },
              effects: []
            };
          }
          return skillObj;
        }
        return s;
      }).filter(s => s !== null);
    } else {
      cloned.battleStartSkills = [];
    }

    cloned.pregnancySystem = {
      isActive: cloned.pregnancySystem?.isActive || false,
      type: cloned.pregnancySystem?.type || null,
      growth: cloned.pregnancySystem?.growth || 0,
      birthingCheckModifier: cloned.pregnancySystem?.birthingCheckModifier || 0,
      sourceName: cloned.pregnancySystem?.sourceName || null,
      pregnancyForced: cloned.pregnancySystem?.pregnancyForced || false
    };

    if (cloned.pregnancySystem.isActive === true) {
      cloned.debuffs = cloned.debuffs.filter(d => d.name !== '孕育');
      const displayName = cloned.pregnancySystem.type === 'parasite' ? '寄生' : '怀孕';
      cloned.debuffs.push({
        name: '孕育',
        displayName: displayName,
        description: cloned.pregnancySystem.type === 'parasite' ? '体内有异物寄生，每回合吸取生命' : '体内孕育着生命，每回合消耗体力',
        remainingActions: -1,
        type: 'debuff',
        effects: []
      });
    } else {
      cloned.debuffs = cloned.debuffs.filter(d => d.name !== '孕育');
    }
    cloned.skillCooldowns = {};    

// ========== 从 MVU 读取战斗属性 ==========
const mvuFound = findMvuEntity(mvuStatData, cloned.name);
if (mvuFound && mvuFound.entity) {
    const parsed = readMvuEntityStats(mvuFound.entity);
    if (parsed) {
        cloned.hp = parsed.hp;
        cloned.mp = parsed.mp;
        cloned.atk = parsed.atk;
        cloned.matk = parsed.matk;
        cloned.def = parsed.def;
        cloned.spd = parsed.spd;
        cloned.battleLevel = parsed.battleLevel;
        cloned.exp = parsed.exp;
        cloned.gender = mapGenderToUnit(parsed.genderRaw);
        if (!cloned.种族值) cloned.种族值 = {};
        cloned.种族值.体质种族值加值 = parsed.race.体质种族值加值;
        cloned.种族值.智力种族值加值 = parsed.race.智力种族值加值;
        cloned.种族值.防御种族值加值 = parsed.race.防御种族值加值;
        cloned.种族值.敏捷种族值加值 = parsed.race.敏捷种族值加值;
        cloned.种族值.$体质种族值固定值 = parsed.race.$体质种族值固定值;
        cloned.种族值.$智力种族值固定值 = parsed.race.$智力种族值固定值;
        cloned.种族值.$防御种族值固定值 = parsed.race.$防御种族值固定值;
        cloned.种族值.$敏捷种族值固定值 = parsed.race.$敏捷种族值固定值;
    }
}

    return cloned;
  });
  
  G.playerUnits.forEach(unit => initUnitAP(unit));
const mvuEnemyEntries = getAvailableEnemyEntries();
let enemySeeds = [];   // [{ name, template, recordType, matchMode }]

if (mvuEnemyEntries !== null) {
    if (mvuEnemyEntries.length === 0) {
        addLog('错误: MVU中没有可出战的敌人（attitude=敌对 且 isPresent=true）', 'system');
        return;
    }

    for (const entry of mvuEnemyEntries) {
        let template = null;
        let matchMode = '';

        template = window.loadedEnemies.find(e => e.name === entry.name);
        if (template) {
            matchMode = '同名';
        }

        if (!template && entry.type) {
            template = window.loadedEnemies.find(e => e.name === entry.type);
            if (template) matchMode = `类型:${entry.type}`;
        }

        if (!template) {
            template = { name: entry.name };
            matchMode = '兜底空模板';
            addLog(`⚠️ ${entry.name}（类型:${entry.type || '无'}）未找到任何模板，使用空模板`, 'system');
        }

        enemySeeds.push({
            name: entry.name,
            template: template,
            recordType: entry.recordType,
            matchMode: matchMode,
        });
    }

    addLog(`敌人模板匹配: ${enemySeeds.map(s => `${s.name}[${s.matchMode}]`).join(', ')}`, 'system');
} else {
    enemySeeds = window.loadedEnemies.map(t => ({
        name: t.name,
        template: t,
        recordType: null,
        matchMode: '降级-全模板',
    }));
    addLog('警告: MVU 不可用，使用全部敌人模板', 'system');
}

if (worldbookData.skills) {
    enemySeeds = enemySeeds.map(seed => ({
        ...seed,
        template: resolveSkills([seed.template], worldbookData.skills)[0],
    }));
}
  
G.enemyUnits = [];

const difficultySelect = document.getElementById('difficulty-select');
const difficultyMultiplier = difficultySelect ? parseFloat(difficultySelect.value) : 1.0;
addLog(`难度倍率: ${difficultyMultiplier * 100}%`, 'system');

enemySeeds.forEach((seed, index) => {
  const enemy = clone(seed.template);
  enemy.name = seed.name;              
  enemy.side = 'enemy';
  enemy.id = `e_${Date.now()}_${index}`;
  enemy._mvuRecordType = seed.recordType; 

  if (enemy.specialEnergyMax && typeof enemy.specialEnergyMax === 'object') {
    enemy.specialEnergy = {};
    for (const [type, max] of Object.entries(enemy.specialEnergyMax)) {
      enemy.specialEnergy[type] = { current: 0, max: typeof max === 'number' ? max : 100 };
    }
  } else {
    enemy.specialEnergy = {};
  }

  if (!enemy.stats) {
    enemy.stats = { constitution: 5, intelligence: 5, agility: 5 };
  }
  enemy.stats.constitution = Math.floor((enemy.stats.constitution || 5) * difficultyMultiplier);
  enemy.stats.intelligence = Math.floor((enemy.stats.intelligence || 5) * difficultyMultiplier);
  enemy.stats.agility      = Math.floor((enemy.stats.agility      || 5) * difficultyMultiplier);

  const normalizeSkillArr = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr.map(s => (s && typeof s === 'object') ? normalizeSkillEffects(s) : s);
  };
  enemy.skills         = normalizeSkillArr(enemy.skills);
  enemy.learnedSkills  = normalizeSkillArr(enemy.learnedSkills);
  enemy.equippedSkills = normalizeSkillArr(enemy.equippedSkills);

  if (worldbookData.skills) {
    if (enemy.equippedSkills.length > 0) {
      enemy.equippedSkills = enemy.equippedSkills.map(s =>
        typeof s === 'string' ? (getSkillFromWorldbook(s) || { name: s, requiredLevel: 0 }) : s
      ).filter(Boolean);
    }
    if (enemy.learnedSkills.length > 0) {
      enemy.learnedSkills = enemy.learnedSkills.map(s =>
        typeof s === 'string' ? (getSkillFromWorldbook(s) || { name: s, requiredLevel: 0 }) : s
      ).filter(Boolean);
    }
    if (enemy.skills.length > 0) {
      enemy.skills = enemy.skills.map(s =>
        typeof s === 'string' ? (getSkillFromWorldbook(s) || { name: s }) : s
      ).filter(Boolean);
    }
    if (enemy.battleStartSkills && enemy.battleStartSkills.length > 0) {
      enemy.battleStartSkills = enemy.battleStartSkills.map(s =>
        typeof s === 'string' ? (getSkillFromWorldbook(s) || { name: s, requiredLevel: 0 }) : s
      ).filter(Boolean);
    } else {
      enemy.battleStartSkills = [];
    }
  } else {
    enemy.battleStartSkills = enemy.battleStartSkills || [];
  }

  // 保证 learnedSkills 有值（无则回退到 skills）
  if (!enemy.learnedSkills || enemy.learnedSkills.length === 0) {
    enemy.learnedSkills = Array.isArray(enemy.skills) ? [...enemy.skills] : [];
  }

  const validLearned = enemy.learnedSkills.filter(s => s && typeof s === 'object' && s.name);
  if (validLearned.length > 0) {
    const drawCount = Math.min(4, validLearned.length);
    const drawn = _.shuffle([...validLearned]).slice(0, drawCount);
    enemy.equippedSkills = drawn.map(s => clone(s));
    addLog(
      `${enemy.name} 从 ${validLearned.length} 个已学技能中随机装备 ${drawCount} 个：` +
      `${drawn.map(s => s.name).join('、')}`,
      'system'
    );
  } else {
    enemy.equippedSkills = [];
    addLog(`${enemy.name} 无可用技能，战斗中将只能普通攻击`, 'system');
  }

  const enemyFound = findMvuEntity(mvuStatData, enemy.name);
  if (enemyFound && enemyFound.entity) {
    const parsed = readMvuEntityStats(enemyFound.entity);
    if (parsed) {
      enemy.hp        = parsed.hp;
      enemy.mp        = parsed.mp;
      enemy.atk       = parsed.atk;
      enemy.matk      = parsed.matk;
      enemy.def       = parsed.def;
      enemy.spd       = parsed.spd;
      enemy.battleLevel = parsed.battleLevel;
      enemy.gender    = mapGenderToUnit(parsed.genderRaw);
      const enemyLevelExp = _.get(enemyFound.entity, '角色信息.等级与经验', {});
      enemy._expReward = enemyLevelExp._击败经验值 ?? 0;
    }
  } else {
    addLog(`⚠️ ${enemy.name} 在 MVU 中找不到实体，属性将使用模板默认值`, 'system');
  }

  enemy.stats = enemy.stats || { constitution: 5, intelligence: 5, agility: 5 };
  enemy.clothingIntegrity = enemy.clothingIntegrity !== undefined ? enemy.clothingIntegrity : 100;
  if (!enemy.learnedSkills || enemy.learnedSkills.length === 0) {
    enemy.learnedSkills = enemy.skills || [];
  }
  enemy.actionDistance = 0;
  enemy.nextActionPoint = 0;
  enemy.skillCooldowns = {};
  enemy.pleasure = enemy.pleasure || { current: 0, max: 100, damageBonus: 0 };
  enemy.ac = enemy.ac || [];
  enemy.buffs = enemy.buffs || [];
  enemy.debuffs = enemy.debuffs || [];
  enemy.isStunned = false;
  enemy.isTaunting = false;

  G.enemyUnits.push(enemy);
});

  G.enemyUnits.forEach(unit => initUnitAP(unit));
  
  if (G.enemyUnits.length === 0) {
    addLog('错误: 无法生成敌方单位', 'system');
    return;
  }
  
  addLog(`本场战斗敌方单位: ${G.enemyUnits.map(e => e.name).join(', ')}`, 'system');

  // 执行战斗开始技能
  G.playerUnits.forEach(unit => applyBattleStartSkills(unit));
  G.enemyUnits.forEach(unit => applyBattleStartSkills(unit));

  // 显示战斗界面
  document.getElementById('selection-overlay').classList.remove('show');
  document.getElementById('battle-container').style.display = 'grid';
  const statsButton = document.getElementById('btn-show-all-stats');
  if (statsButton) {
    statsButton.style.display = 'flex';
  }
  G.phase = 'init';
  G.turn = 0;
  G.log = [];
  G.processedUnits = new Set();
  G.actionQueue = [];

  addLog('战斗开始！', 'system');

  G.playerUnits.forEach(unit => {
    updateHPMPOnStatChange(unit);
    updatePleasureBonus(unit);
  });
  G.enemyUnits.forEach(unit => {
    updateHPMPOnStatChange(unit);
    updatePleasureBonus(unit);
  });

  updateUI();
  G.playerUnits.forEach(unit => applyOrRefreshMentalState(unit));
  G.enemyUnits.forEach(unit => applyOrRefreshMentalState(unit));
  setTimeout(() => startTurn(), 500);
}

function initUnitAP(unit) {
    unit.remainingAP = unit.remainingAP || 0;   
    unit.maxAPPerTurn = 100;                   
}

function getUniqueEnemySkills() {
  const skillMap = new Map();
  G.enemyUnits.forEach(enemy => {
    if (enemy.skills && enemy.skills.length > 0) {
      enemy.skills.forEach(skill => {
        if (!skillMap.has(skill.name)) {
          skillMap.set(skill.name, { ...skill, sourceEnemy: enemy.name });
        }
      });
    }
  });
  return Array.from(skillMap.values());
}

function characterHasSkill(unit, skillName) {
  const allSkills = unit.learnedSkills && unit.learnedSkills.length > 0 ? unit.learnedSkills : unit.skills;
  if (!allSkills) return false;
  return allSkills.some(s => s.name === skillName);
}

let learnState = {
  selectedCharacter: null,
  selectedSkill: null
};

function showSkillLearnModal() {
  const modal = document.getElementById('skill-learn-modal');
  const characterList = document.getElementById('learn-character-list');
  const skillList = document.getElementById('learn-skill-list');
  const placeholder = document.getElementById('learn-skill-placeholder');
  const confirmBtn = document.getElementById('btn-confirm-learn');
  learnState = { selectedCharacter: null, selectedSkill: null };
  const alivePlayers = G.playerUnits.filter(u => u.hp.current > 0);
  characterList.innerHTML = '';
  if (alivePlayers.length === 0) {
    characterList.innerHTML = '<div style="padding:20px; color:#999;">没有存活的角色</div>';
  }
  alivePlayers.forEach(unit => {
    const charCard = document.createElement('div');
    charCard.style.cssText = 'padding:10px; background:white; border:2px solid var(--neutral-300); border-radius:8px; cursor:pointer;';
    charCard.innerHTML = `
      <div style="font-weight:bold;">${unit.name}</div>
      <div style="font-size:0.8em; color:#666;">Lv.${unit.battleLevel}</div>
      <div style="font-size:0.7em; color:#999;">已学技能: ${(unit.learnedSkills || unit.skills || []).length}个 | 已装备: ${(unit.equippedSkills || []).length}/6</div>
    `;
    charCard.onclick = () => {
      characterList.querySelectorAll('div').forEach(el => { el.style.borderColor = 'var(--neutral-300)'; el.style.background = 'white'; });
      charCard.style.borderColor = 'var(--primary-500)';
      charCard.style.background = 'var(--primary-50)';
      learnState.selectedCharacter = unit;
      learnState.selectedSkill = null;
      confirmBtn.disabled = true;
      renderSkillLearnList();
    };
    characterList.appendChild(charCard);
  });
  skillList.innerHTML = '';
  skillList.style.display = 'none';
  placeholder.style.display = 'block';
  confirmBtn.disabled = true;
  modal.classList.add('show');
}

function renderSkillLearnList() {
  const skillList = document.getElementById('learn-skill-list');
  const placeholder = document.getElementById('learn-skill-placeholder');
  const confirmBtn = document.getElementById('btn-confirm-learn');
  const unit = learnState.selectedCharacter;
  if (!unit) return;
  const uniqueSkills = getUniqueEnemySkills();
  skillList.innerHTML = '';
  skillList.style.display = 'flex';
  placeholder.style.display = 'none';
  confirmBtn.disabled = true;
  learnState.selectedSkill = null;
  if (uniqueSkills.length === 0) {
    skillList.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">本场战斗没有可学习的技能</div>';
    return;
  }
  uniqueSkills.forEach(skill => {
    const hasSkill = characterHasSkill(unit, skill.name);
    const skillLevelSufficient = canUseSkill(unit, skill);
    const skillReqLevel = getSkillRequiredLevel(skill);
    const skillCard = document.createElement('div');
    skillCard.className = 'skill-item';
    if (hasSkill) {
      skillCard.classList.add('disabled');
      skillCard.style.opacity = '0.5';
      skillCard.style.cursor = 'not-allowed';
    }
    let targetLabel = '';
    switch(skill.targetType) {
      case 'single_enemy': targetLabel = '单体'; break;
      case 'all_enemies': targetLabel = '全体'; break;
      case 'single_ally': targetLabel = '友方'; break;
      case 'all_allies': targetLabel = '全体友方'; break;
      case 'random_enemy': targetLabel = '随机'; break;
      case 'self': targetLabel = '自身'; break;
    }
    const actionLabel = skill.actionType === 'attack' ? '攻击' : '非攻击';
    skillCard.innerHTML = `
      <div class="skill-name">
        ${skill.name}
        <span class="skill-target-type">${targetLabel}</span>
        <span class="skill-action-type ${skill.actionType}">${actionLabel}</span>
        ${hasSkill ? '<span style="color:#c9445a; font-size:0.7em;">（已习得）</span>' : ''}
      </div>
      <div class="skill-info">
                ${skill.description || '无描述'}<br>
        来源: ${skill.sourceEnemy}
        ${skillReqLevel > 0 ? `<br><span style="color:${skillLevelSufficient ? '#5aaa8a' : '#c49a3c'};">需要Lv.${skillReqLevel}${skillLevelSufficient ? '' : '(未满足)'}</span>` : ''}
      </div>
    `;
    if (!hasSkill) {
      skillCard.onclick = () => {
        skillList.querySelectorAll('.skill-item').forEach(el => { el.style.borderColor = 'var(--neutral-300)'; el.style.background = 'white'; });
        skillCard.style.borderColor = 'var(--primary-500)';
        skillCard.style.background = 'var(--primary-50)';
        learnState.selectedSkill = skill;
        confirmBtn.disabled = false;
      };
    }
    skillList.appendChild(skillCard);
  });
}

function confirmLearnSkill() {
  const unit = learnState.selectedCharacter;
  const skill = learnState.selectedSkill;
  if (!unit || !skill) return;
  const alreadyPending = pendingLearnedSkills.some(p => p.unitId === unit.id && p.skill.name === skill.name);
  if (alreadyPending || characterHasSkill(unit, skill.name)) {
    alert(`${unit.name} 已经拥有或已选择学习 ${skill.name}`);
    return;
  }
  const skillReqLevel = getSkillRequiredLevel(skill);
  if (skillReqLevel > 0 && !canUseSkill(unit, skill)) {
    if (!confirm(`${skill.name} 需要Lv.${skillReqLevel}才能使用，当前${unit.name}等级为Lv.${unit.battleLevel}。\n可以学习但战斗中暂时无法使用，确定学习吗？`)) {
      return;
    }
  }  
  const newSkill = JSON.parse(JSON.stringify(skill));
  delete newSkill.sourceEnemy;
  pendingLearnedSkills.push({ unitId: unit.id, skill: newSkill });
  renderSkillLearnList();
  learnState.selectedSkill = null;
  document.getElementById('btn-confirm-learn').disabled = true;
}

function skipLearnSkill() {
  document.getElementById('skill-learn-modal').classList.remove('show');
  showGameOverModal(true);  
}

function showGameOverModal(isVictory) {
  const title = isVictory ? '胜利' : '败北';
  document.getElementById('gameover-title').textContent = title;
  
  const stats = `
    <p>战斗回合：${G.turn}</p>
    <p>存活单位：${G.playerUnits.filter(u => u.hp.current > 0).length}</p>
    ${pendingLearnedSkills.length > 0 ? `<p>待学习技能：${pendingLearnedSkills.map(p => p.skill.name).join(', ')}</p>` : ''}
  `;
  document.getElementById('gameover-stats').innerHTML = stats;
  document.getElementById('gameover-modal').classList.add('show');
  
  if (isVictory) {
    document.getElementById('btn-confirm-save').style.display = 'inline-block';
    document.getElementById('btn-refight').style.display = 'inline-block';
  } else {
    document.getElementById('btn-confirm-save').style.display = 'none';
    document.getElementById('btn-refight').style.display = 'inline-block';
  }
  
  document.getElementById('btn-generate-report').onclick = generateBattleReport;

}

function showAllUnitsStats() {
  const modal = document.getElementById('all-stats-modal');
  const playerDetail = document.getElementById('player-stats-detail');
  const enemyDetail = document.getElementById('enemy-stats-detail');
  
  playerDetail.innerHTML = '';
  enemyDetail.innerHTML = '';
  
  G.playerUnits.forEach(unit => {
    playerDetail.appendChild(createDetailedStatCard(unit));
  });
  
  G.enemyUnits.forEach(unit => {
    enemyDetail.appendChild(createDetailedStatCard(unit));
  });
  
  modal.classList.add('show');
}

function showSkillImageModal(imageUrl, skillName) {
  if (!imageUrl) return;
  
  let modal = document.getElementById('skill-image-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'skill-image-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 80vw; text-align: center;">
        <h2 class="modal-title" id="skill-image-title"></h2>
        <div style="margin: 20px 0;" id="skill-image-container">
          <!-- 这里动态插入 img 或 video -->
        </div>
        <button class="gem-button secondary" id="close-skill-image-btn">关闭</button>
      </div>
    `;
    document.body.appendChild(modal);
    
    const closeBtn = document.getElementById('close-skill-image-btn');
    closeBtn.onclick = () => modal.classList.remove('show');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };
  }
  
  const title = modal.querySelector('#skill-image-title');
  title.textContent = skillName;
  
  const container = document.getElementById('skill-image-container');
  container.innerHTML = ''; 
  
  const urlLower = imageUrl.toLowerCase();
  const isMp4 = urlLower.endsWith('.mp4') || urlLower.includes('.mp4?');
  
  if (isMp4) {
    const video = document.createElement('video');
    video.src = imageUrl;
    video.autoplay = true;
    video.loop = true;
    video.controls = true;      
    video.muted = false;       
    video.style.maxWidth = '100%';
    video.style.maxHeight = '70vh';
    video.style.borderRadius = '8px';
    container.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '70vh';
    img.style.borderRadius = '8px';
    container.appendChild(img);
  }
  
  modal.classList.add('show');
}

function createDetailedStatCard(unit) {
  const card = document.createElement('div');
  card.style.cssText = `
    padding: 15px;
    background: white;
    border: 2px solid var(--neutral-300);
    border-radius: 12px;
    box-shadow: var(--shadow-sm);
  `;
  
  const finalATK = calculateBaseATK(unit);
  const con = getFinalStat(unit, 'constitution');
  const int = getFinalStat(unit, 'intelligence');
  const agi = getFinalStat(unit, 'agility');
  const actionCost = calculateActionCost(unit);
  const maxActions = Math.floor(100 / actionCost);
  
  const equippedSkillNames = (unit.equippedSkills || []).map(s => s.name).join(', ') || '无';
  const learnedSkillNames = (unit.learnedSkills || unit.skills || []).map(s => s.name).join(', ') || '无';
  
  const formatEffectText = (effect) => {
    if (effect.type === 'custom_debuff') {
      const name = effect.name || effect.displayName || '自定义状态';
      const desc = effect.description ? ` (${effect.description})` : '';
      return `${name}${desc}`;
    }
    const statName = effect.stat || effect.type || '效果';
    let valueText = '';
    if (effect.value !== undefined) {
      if (statName === 'pleasure_dot' || statName === 'bleed' || statName === 'burn') {
        valueText = `${effect.value > 0 ? '+' : ''}${effect.value}`;
      } else {
        valueText = `${effect.value > 0 ? '+' : ''}${(effect.value * 100).toFixed(0)}%`;
      }
    } else if (effect.currentValue !== undefined) {
      valueText = `${effect.currentValue > 0 ? '+' : ''}${effect.currentValue}`;
    }
    return `${statName}: ${valueText}`;
  };

  card.innerHTML = `
    <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 12px;">
      ${unit.portraitUrl ? `
        <div style="
          width: 60px;
          height: 80px;
          border-radius: 8px;
          background-image: url('${unit.portraitUrl}');
          background-size: cover;
          background-position: center;
          border: 2px solid var(--primary-300);
        "></div>
      ` : `
        <div style="
          width: 60px;
          height: 80px;
          border-radius: 8px;
          background: var(--neutral-300);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          color: var(--neutral-600);
        ">?</div>
      `}
      <div style="flex: 1;">
        <div style="font-weight: bold; font-size: 1.1em; color: var(--primary-700); margin-bottom: 5px;">
          ${unit.name}
          <span style="font-size: 0.8em; color: ${unit.gender === 'male' ? '#5b8fbf' : '#e879a8'};">${unit.gender === 'male' ? '♂' : '♀'}</span>
          <span style="font-size: 0.7em; color: #ffd700; margin-left: 8px;">Lv.${unit.battleLevel}</span>
          ${unit.isBoss ? '<span style="background: #c9445a; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7em; margin-left: 5px;">BOSS</span>' : ''}
          ${unit.isSummoned ? '<span style="background: #5b8fbf; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7em; margin-left: 5px;">召唤</span>' : ''}
        </div>
        <div style="font-size: 0.8em; color: #666; margin-bottom: 3px;">
          ${unit.hp.current <= 0 ? '<span style="color: #c9445a;">💀 已战败</span>' : 
            unit.isStunned ? '<span style="color: #c49a3c;">💫 眩晕中</span>' : 
            '✅ 可行动'}
        </div>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
      <div>
        <div style="font-weight: bold; color: var(--primary-700); margin-bottom: 8px; border-bottom: 2px solid var(--primary-200); padding-bottom: 4px;">
          📊 属性
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="font-size: 0.75em; color: #666; margin-bottom: 2px;">HP</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="flex: 1; height: 6px; background: rgba(201, 68, 90, 0.2); border-radius: 3px; overflow: hidden;">
              <div style="width: ${(unit.hp.current / unit.hp.max) * 100}%; height: 100%; background: var(--hp-bar); transition: width 0.3s;"></div>
            </div>
            <span style="font-size: 0.7em; font-weight: bold;">${unit.hp.current}/${unit.hp.max}</span>
          </div>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="font-size: 0.75em; color: #666; margin-bottom: 2px;">MP</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="flex: 1; height: 6px; background: rgba(91, 143, 191, 0.2); border-radius: 3px; overflow: hidden;">
              <div style="width: ${(unit.mp.current / unit.mp.max) * 100}%; height: 100%; background: var(--mp-bar); transition: width 0.3s;"></div>
            </div>
            <span style="font-size: 0.7em; font-weight: bold;">${unit.mp.current}/${unit.mp.max}</span>
          </div>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="font-size: 0.75em; color: #666; margin-bottom: 2px;">情欲值</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="flex: 1; height: 6px; background: rgba(232, 121, 168, 0.2); border-radius: 3px; overflow: hidden;">
              <div style="width: ${(unit.pleasure.current / unit.pleasure.max) * 100}%; height: 100%; background: var(--pleasure-bar); transition: width 0.3s;"></div>
            </div>
            <span style="font-size: 0.7em; font-weight: bold;">${unit.pleasure.current}/${unit.pleasure.max}</span>
          </div>
        </div>

        <div style="margin-bottom: 8px;">
          <div style="font-size: 0.75em; color: #666; margin-bottom: 2px;">服装耐久度</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="flex: 1; height: 6px; background: rgba(196, 154, 60, 0.2); border-radius: 3px; overflow: hidden;">
              <div style="width: ${unit.clothingIntegrity || 100}%; height: 100%; background: linear-gradient(90deg, #c49a3c, #d4a84c); transition: width 0.3s;"></div>
            </div>
            <span style="font-size: 0.7em; font-weight: bold;">${unit.clothingIntegrity || 100}%</span>
          </div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 10px; background: var(--primary-50); padding: 8px; border-radius: 6px;">
          <div style="font-size: 0.75em;">
            <span style="color: #666;">体质:</span>
            <span style="font-weight: bold; margin-left: 5px;">${con}</span>
          </div>
          <div style="font-size: 0.75em;">
            <span style="color: #666;">智力:</span>
            <span style="font-weight: bold; margin-left: 5px;">${int}</span>
          </div>
          <div style="font-size: 0.75em;">
            <span style="color: #666;">敏捷:</span>
            <span style="font-weight: bold; margin-left: 5px;">${agi}</span>
          </div>
          <div style="font-size: 0.75em;">
            <span style="color: #666;">ATK:</span>
            <span style="font-weight: bold; margin-left: 5px;">${finalATK}</span>
          </div>
        </div>
        
        <div style="margin-top: 10px; font-size: 0.7em; color: #666;">
          <div>⏱️ 行动消耗: ${actionCost}</div>
          <div>🔄 每回合行动次数: ${maxActions}</div>
          ${unit.side === 'player' && unit.battleLevel < 100 ? `
            <div style="margin-top: 5px;">
              <span style="color: #7c4dca;">⭐ EXP:</span> 
              <span>${unit.exp || 0}/${expToNextLevel(unit.battleLevel)}</span>
              <div style="height: 4px; background: rgba(124, 77, 202, 0.2); border-radius: 2px; margin-top: 2px; overflow: hidden;">
                <div style="width: ${Math.min(100, ((unit.exp || 0) / expToNextLevel(unit.battleLevel)) * 100)}%; height: 100%; background: linear-gradient(90deg, #7c4dca, #9b75e0);"></div>
              </div>
            </div>
          ` : ''}
          ${unit.side === 'player' && unit.freeAttributePoints > 0 ? `
            <div style="color: #ffd700; margin-top: 3px;">✨ 未分配属性点: ${unit.freeAttributePoints}</div>
          ` : ''}
        </div>
      </div>
      
      <div>
        <div style="font-weight: bold; color: var(--primary-700); margin-bottom: 8px; border-bottom: 2px solid var(--primary-200); padding-bottom: 4px;">
          ⚔️ 技能
        </div>
        <div style="font-size: 0.7em; color: #666; margin-bottom: 5px;">
          <strong>装备技能 (${(unit.equippedSkills || []).length}/6):</strong>
          <div style="color: #7c4dca;">${escapeHtml(equippedSkillNames)}</div>
        </div>
        <div style="font-size: 0.7em; color: #666; margin-bottom: 8px;">
          <strong>已学技能:</strong>
          <div>${escapeHtml(learnedSkillNames)}</div>
        </div>
        
        <div style="font-weight: bold; color: var(--primary-700); margin-top: 12px; margin-bottom: 8px; border-bottom: 2px solid var(--primary-200); padding-bottom: 4px;">
          🛡️ 状态效果
        </div>
        <div style="font-size: 0.7em;">
          ${unit.buffs.length > 0 ? `
            <div style="margin-bottom: 5px;">
              <span style="color: #5aaa8a;">增益:</span>
              ${unit.buffs.map(b => {
                let remainingTurn = b.duration ?? b.remainingActions ?? b.remainingTurns ?? '?';
                const turnDisplay = remainingTurn === -1 ? '∞' : remainingTurn;
                return `
                <div style="margin-left: 10px; color: #666;">
                  • ${b.name} (剩余${turnDisplay}回合)
                  ${b.effects ? b.effects.map(e => `<br><span style="margin-left: 20px;">- ${formatEffectText(e)}</span>`).join('') : ''}
                </div>
              `}).join('')}
            </div>
          ` : '<div style="color: #999;">无增益效果</div>'}
          
          ${unit.debuffs.length > 0 ? `
            <div style="margin-bottom: 5px; margin-top: 8px;">
              <span style="color: #c9445a;">减益:</span>
              ${unit.debuffs.map(d => {
                let remainingTurn = d.duration ?? d.remainingActions ?? d.remainingTurns ?? '?';
                const turnDisplay = remainingTurn === -1 ? '∞' : remainingTurn;
                return `
                <div style="margin-left: 10px; color: #666;">
                  • ${d.name} (剩余${turnDisplay}回合)
                  ${d.effects ? d.effects.map(e => `<br><span style="margin-left: 20px;">- ${formatEffectText(e)}</span>`).join('') : ''}
                </div>
              `}).join('')}
            </div>
          ` : '<div style="color: #999;">无减益效果</div>'}
        </div>
        
        ${unit.ac.length > 0 ? `
          <div style="margin-top: 8px;">
            <div style="font-weight: bold; color: var(--primary-700); margin-bottom: 5px; border-bottom: 2px solid var(--primary-200); padding-bottom: 4px;">
              🛡️ 护甲
            </div>
            <div style="font-size: 0.7em;">
              ${unit.ac.map(ac => `
                <div style="margin-left: 10px; color: #666;">
                  • ${ac.source}: ${ac.current}/${ac.max} (剩余${ac.remainingTurns}回合)
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
  
  return card;
}
// ========== 自定义战斗日志功能 ==========

function getRandomCustomLog(skill, attacker, defender = null) {
  if (!skill || !skill.customLogs) return null;
  
  let logs = skill.customLogs;
  if (typeof logs === 'string') logs = [logs];
  if (!Array.isArray(logs) || logs.length === 0) return null;
  
  const randomIndex = Math.floor(Math.random() * logs.length);
  let logText = logs[randomIndex];
  
  logText = logText.replace(/\{attacker\}/g, attacker?.name || '未知');
  logText = logText.replace(/\{defender\}/g, defender?.name || '目标');
  
  return logText;
}

function getStatusTooltip(status) {
  let lines = [];
  if (status.description) lines.push(status.description);
  if (status.effects && status.effects.length > 0) {
    lines.push('效果:');
    status.effects.forEach(e => {
      let text = '';
      const stat = e.stat || e.type;
      const val = e.currentValue !== undefined ? e.currentValue : (e.value !== undefined ? e.value : 0);
      if (stat === 'constitution') text = `体质 ${val > 0 ? '+' : ''}${Math.round(val*100)}%`;
      else if (stat === 'intelligence') text = `智力 ${val > 0 ? '+' : ''}${Math.round(val*100)}%`;
      else if (stat === 'agility') text = `敏捷 ${val > 0 ? '+' : ''}${Math.round(val*100)}%`;
      else if (stat === 'def') text = `所受伤害 ${val > 0 ? '-' : '+'}${Math.round(Math.abs(val)*100)}%`;
      else if (stat === 'bleed') text = `每回合流血 ${val} 点`;
      else if (stat === 'burn') text = `每回合灼烧 ${val} 点`;
      else if (stat === 'pleasure_dot') text = `每回合情欲伤害 +${val}`;
      else if (stat === 'pleasure_damage_taken') text = `受到情欲伤害 ${val > 0 ? '+' : ''}${Math.round(val*100)}%`;
      else if (stat === 'stun') text = `无法行动`;
      else if (stat === 'taunt') text = `强制敌人攻击自己`;
      else if (stat === 'accuracy') text = `命中率 ${val > 0 ? '+' : ''}${val}%`;
      else if (stat === 'evasion') text = `闪避率 ${val > 0 ? '+' : ''}${val}%`;
      else if (stat === 'damage_multiplier') text = `造成伤害 ${val > 0 ? '+' : ''}${Math.round(val*100)}%`;
      else if (stat === 'restraint') text = `被拘束无法自由行动`;
      else if (e.type === 'custom_debuff') text = `${e.name || '特殊状态'}`;
      else text = `${stat}: ${val}`;
      lines.push(`  • ${text}`);
    });
  }
  if (status.stackable && status.totalLayers > 0) {
    lines.push(`当前总层数: ${status.totalLayers}`);
    if (status.layerDetails && status.layerDetails.length) {
      const minTurns = Math.min(...status.layerDetails.map(l => l.remainingTurns === -1 ? Infinity : l.remainingTurns));
      if (isFinite(minTurns)) lines.push(`失效: ${minTurns}回合后`);
    }
  }
  return lines.join('\n');
}

function setGestation(unit, type, sourceName = null) {
    if (!unit.pregnancySystem) {
        unit.pregnancySystem = {
            isActive: false,
            type: null,
            growth: 0,
            birthingCheckModifier: 0,
            sourceName: null
        };
    }
    
    if (unit.pregnancySystem.isActive === true) {
        addLog(`${unit.name}已经处于${unit.pregnancySystem.type === 'parasite' ? '寄生' : '怀孕'}状态，无法再次施加！`, 'system');
        return false;
    }
    
    const hasGestationDebuff = unit.debuffs && unit.debuffs.some(d => d.name === '孕育');
    if (hasGestationDebuff) {
        return false;
    }
    
    unit.pregnancySystem.isActive = true;
    unit.pregnancySystem.type = type;
    unit.pregnancySystem.growth = 0;
    unit.pregnancySystem.birthingCheckModifier = 0;
    unit.pregnancySystem.sourceName = sourceName;
    
    const displayName = type === 'parasite' ? '寄生' : '怀孕';
    unit.debuffs.push({
        name: '孕育',
        displayName: displayName,
        description: type === 'parasite' ? '体内有异物寄生，每回合吸取生命' : '体内孕育着生命，每回合消耗体力',
        remainingActions: -1,
        type: 'debuff',
        effects: []
    });
    
    addLog(`${unit.name}${type === 'parasite' ? '被异物寄生了！' : '怀孕了！'}`, type === 'parasite' ? 'system' : 'orgasm');
    updateUI();
    return true;
}

function setInfested(unit) {
    return setGestation(unit, 'parasite');
}

function setPregnant(unit) {
    return setGestation(unit, 'pregnancy');
}

function handleParasiteSystem(unit, gameContext) {
    if (!unit.pregnancySystem?.isActive) return false;
    
    const isParasite = unit.pregnancySystem.type === 'parasite';
    const typeName = isParasite ? '寄生体' : '胎儿';
    const birthName = isParasite ? '寄生兽' : '新生触手怪';
    const birthAction = isParasite ? '出生' : '分娩';
    
    if (unit.pregnancySystem.growth >= 100) {
        const checkDifficulty = 50 - unit.pregnancySystem.birthingCheckModifier;
        const roll = Math.floor(Math.random() * 100) + 1;
        
        addLog(`${unit.name}的${typeName}试图${birthAction}！`, 'system');
        
        if (roll >= checkDifficulty) {
            triggerParasiteBirth(unit, gameContext);
            return true;
        } else {
            unit.pregnancySystem.birthingCheckModifier += 10;
            addLog(`${unit.name}${birthAction}失败，难度增加...`, 'system');
        }
        return false;
    }
    
    if (unit.pregnancySystem.growth < 100) {
        const hpCost = Math.max(1, Math.floor(unit.hp.max * 0.05));
        const actualDamage = Math.min(hpCost, unit.hp.current);
        
        unit.hp.current = Math.max(0, unit.hp.current - actualDamage);
        
        unit.pregnancySystem.growth += actualDamage;
        unit.pregnancySystem.growth = Math.min(unit.pregnancySystem.growth, 100);
        
        const actionText = isParasite ? '吸取' : '消耗';
        addLog(`${typeName}${actionText}了 ${unit.name} ${actualDamage}点生命！成长值 → ${unit.pregnancySystem.growth}/100`, 'damage');
        showFloat(unit, `-${actualDamage}`, 'damage');
        
        if (checkDeath(unit)) return true;
        
        // ===== 修复：寄生胎动导致眩晕，持续1次行动 =====
        // 使用 Math.random() 并设置合理的概率
        const movementChance = (unit.pregnancySystem.growth / 100) * 0.3; // 最大30%
        if (Math.random() < movementChance && unit.pregnancySystem.growth < 100 && !unit.isStunned) {
            const movementText = isParasite ? '体内的寄生体剧烈活动' : '感到一阵剧烈的胎动';
            addLog(`${unit.name}${movementText}，导致其无法行动！`, 'system');
            unit.isStunned = true;
            const stunName = isParasite ? '寄生胎动' : '胎动';
            // 检查是否已存在相同的眩晕debuff，避免重复添加
            const existingStun = unit.debuffs.find(d => d.name === stunName);
            if (!existingStun) {
                unit.debuffs.push({
    name: stunName,
    description: isParasite ? '寄生体剧烈蠕动导致无法行动' : '胎儿剧烈活动导致无法行动',
    duration: 1,
    type: 'debuff',
    effects: [{ stat: 'stun', value: 1, duration: 1 }]
});
            }
            updateUI();
            return true; 
        }
    }
    
    updateUI();
    return false;
}

/**
 * 触发寄生体出产
 */
function triggerParasiteBirth(unit, gameContext) {
    const isParasite = unit.pregnancySystem?.type === 'parasite';
    const typeName = isParasite ? '寄生体' : '胎儿';
    const birthName = isParasite ? '寄生兽' : '新生触手怪';
    const birthAction = isParasite ? '出生' : '分娩';
    
    addLog(`${unit.name}的${typeName}${birthAction}了！`, 'orgasm');
    showFloat(unit, birthAction + '！', 'pleasure');
    
    const birthDamage = Math.floor(unit.hp.max * 0.3);
    const actualDamage = Math.min(birthDamage, unit.hp.current);
    unit.hp.current = Math.max(0, unit.hp.current - actualDamage);
    addLog(`${unit.name}因${birthAction}减少了${actualDamage}点体力！`, 'damage');
    
    if (!isParasite) {
        const allOtherUnits = [...gameContext.playerUnits, ...gameContext.enemyUnits].filter(u => u.id !== unit.id);
        allOtherUnits.forEach(otherUnit => {
            if (otherUnit.hp.current > 0) {
                addLog(`${otherUnit.name}因${birthAction}而暂停行动！`, 'system');
                gameContext.processedUnits.add(otherUnit.id);
            }
        });
    }
    
    const newborn = {
        id: `${isParasite ? 'parasite' : 'newborn'}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        name: birthName,
        gender: 'unknown',
        side: 'enemy',
        isBoss: false,
        isSummoned: true,
        battleLevel: Math.max(1, Math.floor((unit.battleLevel || 1) * (isParasite ? 0.8 : 0.6))),
        hp: { current: isParasite ? 80 : 40, max: isParasite ? 80 : 40 },
        mp: { current: isParasite ? 20 : 10, max: isParasite ? 20 : 10 },
        atk: { base: isParasite ? 15 : 10 },
        pleasure: { current: 0, max: isParasite ? 80 : 60, damageBonus: 0 },
        ac: [],
        clothingIntegrity: 100,
        stats: isParasite ? { constitution: 6, intelligence: 3, agility: 120 } : { constitution: 5, intelligence: 2, agility: 100 },
        skills: [{
            name: '触手抽击',
            type: 'skill',
            targetType: 'single_enemy',
            actionType: 'attack',
            damageType: 'physical',
            cost: { hp: 0, mp: 0 },
            multiplier: isParasite ? 1.2 : 1.0,
            effects: [],
            description: '用触手抽击敌人',
            ignoreArmor: false,
            pleasurePercent: 0,
            pleasureAttrMultiplier: 0
        }],
        buffs: [],
        debuffs: [],
        isStunned: false,
        isTaunting: false,
        actionDistance: 0,
        nextActionPoint: 0,
        portraitUrl: null
    };
    
    gameContext.enemyUnits.push(newborn);
    addLog(`一只【${newborn.name}】从${unit.name}体内诞生了！`, 'system');
    
    unit.isStunned = true;
    unit.debuffs.push({
    name: isParasite ? '出产后虚弱' : '分娩后虚弱',
    description: isParasite ? '出产后身体虚弱' : '分娩后身体虚弱',
    duration: 2,  
    type: 'debuff',
    effects: [
        { stat: 'constitution', value: -0.3, duration: 2 },
        { stat: 'agility', value: -0.3, duration: 2 }
    ]
});
    
    if (unit.pregnancySystem) {
        unit.pregnancySystem.isActive = false;
        unit.pregnancySystem.growth = 0;
        unit.pregnancySystem.birthingCheckModifier = 0;
        unit.pregnancySystem.type = null;
        unit.pregnancySystem.sourceName = null;
    }
    
    unit.debuffs = unit.debuffs.filter(d => d.name !== '孕育');
    
    updateHPMPOnStatChange(unit);
    updateUI();
 
    checkDeath(unit);
 
    recalculateActionOrder();
}

/**
 * 处理怀孕系统（兼容原有系统）
 */
function handlePregnancySystem(unit, gameContext) {
    if (!unit.maternalSystem?.isPregnant) return false;
    
    // 检查是否出产
    if (unit.maternalSystem.fetusGrowth >= 100) {
        // ===== 获取来源名称用于生成召唤物名字 =====
        const sourceName = unit.maternalSystem?.fatherName || unit.pregnancySystem?.sourceName || '未知';
        const newbornName = `${sourceName}之裔`;
        
        // 触发正常出产，使用模板但名字动态生成
        const newborn = {
            id: `newborn_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            name: newbornName,  // 动态生成的名字
            gender: 'unknown',
            side: 'enemy',
            isSummoned: true,
            isBoss: false,
            battleLevel: Math.max(1, Math.floor((unit.battleLevel || 1) * 0.6)),
            hp: { current: 40, max: 40 },
            mp: { current: 10, max: 10 },
            atk: { base: 10 },
            pleasure: { current: 0, max: 60, damageBonus: 0 },
            ac: [],
            clothingIntegrity: 100,
            stats: { constitution: 5, intelligence: 2, agility: 100 },
            skills: [{
                name: '触手抽击',
                type: 'skill',
                targetType: 'single_enemy',
                actionType: 'attack',
                damageType: 'physical',
                cost: { hp: 0, mp: 0 },
                multiplier: 1.0,
                effects: [],
                description: '用触手抽击敌人',
                ignoreArmor: false,
                pleasurePercent: 0,
                pleasureAttrMultiplier: 0
            }],
            buffs: [],
            debuffs: [],
            isStunned: false,
            isTaunting: false,
            actionDistance: 0,
            nextActionPoint: 0,
            portraitUrl: null,
            sourceParent: unit.name,
            sourceOriginal: sourceName
        };
        
        G.enemyUnits.push(newborn);
        addLog(`【${newborn.name}】从${unit.name}体内诞生了！`, 'system');
        
        unit.maternalSystem.isPregnant = false;
        unit.maternalSystem.fetusGrowth = 0;
        unit.debuffs = unit.debuffs.filter(d => d.name !== '怀孕');
        
        return true;
    }
    
    // 胎动判定（最大35%）
    const fetalMovementChance = (unit.maternalSystem.fetusGrowth / 100) * 0.35;
    if (Math.random() < fetalMovementChance) {
        addLog(`${unit.name}感到一阵剧烈的胎动，无法行动！`, 'system');
        unit.isStunned = true;
        unit.debuffs.push({
    name: '胎动',
    description: '胎儿剧烈活动',
    duration: 1,  
    type: 'debuff',
    effects: [{ stat: 'stun', value: 1, duration: 1 }]
});

        return true;
    }
    
    return false;
}

function generateBattleReport() {
  const filterKeywords = [
    '还有剩余行动次数，请继续选择技能',
    '战报提示词已复制到剪贴板',
    '数据已确认保存',
    '玩家状态已保存',
    '战斗结果和技能已保存',
    '战斗进度已保存',
    '战斗结果已保存',
    '返回战斗结果界面'
  ];
  const filteredLog = G.log.filter(entry => {
    const cleanMessage = entry.message.replace(/<[^>]*>/g, '');
    return !filterKeywords.some(keyword => cleanMessage.includes(keyword));
  });
  let report = '';
  const win = G.playerUnits.some(u => u.hp.current > 0) && G.enemyUnits.every(u => u.hp.current <= 0);
  report += `战斗结果: ${win ? '胜利' : '败北'}\n总回合数: ${G.turn}\n\n--- 完整战斗日志 ---\n\n`;
  filteredLog.forEach(entry => {
    const cleanMessage = entry.message.replace(/<[^>]*>/g, '');
    report += `[回合${entry.turn}] ${cleanMessage}\n`;
  });
  const promptText = `请根据以下战斗日志，生动地描写一段战斗过程中的场景：\n\n${report}`;
  navigator.clipboard.writeText(promptText).then(() => {
    const btn = document.getElementById('btn-generate-report');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = '已复制!';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
    }
    addLog('战报提示词已复制到剪贴板', 'system');
  }).catch(() => {
    addLog('复制失败', 'system');
    alert('复制失败');
  });
}

document.getElementById('btn-confirm-save').onclick = () => {
  distributeExp();
  pendingLearnedSkills.forEach(p => {
    const unit = G.playerUnits.find(u => u.id === p.unitId);
    if (unit) {
      if (!unit.learnedSkills) unit.learnedSkills = [];
      if (!unit.learnedSkills.some(s => s.name === p.skill.name)) {
        unit.learnedSkills.push(p.skill);
        addLog(`${unit.name} 学会了新技能：${p.skill.name}！`, 'system');
      }
    }
  });
  pendingLearnedSkills = [];
  savePlayerState().then(() => { addLog('战斗结果和技能已保存', 'system'); });
  document.getElementById('btn-confirm-save').style.display = 'none';
  document.getElementById('btn-refight').style.display = 'none';
  addLog('数据已确认保存', 'system');
};

document.getElementById('btn-refight').onclick = () => {
  if (!preBattlePlayerData) { alert('无法恢复战斗前数据'); return; }
  pendingLearnedSkills = [];
  document.getElementById('gameover-modal').classList.remove('show');
  document.getElementById('skill-learn-modal').classList.remove('show');
  addLog('使用战斗前数据重新开始战斗', 'system');
  startBattle(JSON.parse(JSON.stringify(preBattlePlayerData)));
};

const expandBtn = document.getElementById('btn-expand-log');
if (expandBtn) {
  expandBtn.onclick = () => showLogModal();
}

const closeModalBtn = document.getElementById('btn-close-log-modal');
if (closeModalBtn) {
  closeModalBtn.onclick = () => closeLogModal();
}

const closeFooterBtn = document.getElementById('btn-close-log-footer');
if (closeFooterBtn) {
  closeFooterBtn.onclick = () => closeLogModal();
}

const copyBtn = document.getElementById('btn-copy-log');
if (copyBtn) {
  copyBtn.onclick = () => copyLogToClipboard();
}

const logModal = document.getElementById('log-modal');
if (logModal) {
  logModal.addEventListener('click', function(e) {
    if (e.target === this) {
      closeLogModal();
    }
  });
}

document.getElementById('btn-end-turn').onclick = () => {
  if (G.phase === 'player_turn') {
    addLog('玩家手动结束回合', 'system');
    
    G.playerUnits.forEach(unit => {
      if (unit.hp.current > 0) {
        G.processedUnits.add(unit.id);
      }
    });
    
    G.selectedUnit = null;
    G.selectedSkill = null;
    
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      if (!overlay.id.includes('gameover') && !overlay.id.includes('selection')) {
        overlay.classList.remove('show');
      }
    });
    
    updateUI();
    
    recalculateActionOrder();
    
    if (G.actionQueue.length === 0) {
      endTurn();
    } else {
      setTimeout(() => processNextAction(), 300);
    }
  }
};

document.getElementById('btn-skip').onclick = () => {
  if (G.phase === 'player_turn' && G.actionQueue.length > 0) {
    const unit = G.actionQueue[0];
    if (unit && unit.side === 'player') {
      if (unit.hp.current <= 0) {
        addLog(`${unit.name}已战败，无法行动`, 'system');
        return;
      }
      if (G.processedUnits.has(unit.id)) {
        addLog(`${unit.name}本回合已经行动过了`, 'system');
        return;
      }
      addLog(`${unit.name}选择了跳过行动`, 'system');
      
      const cost = getBaseActionCost(unit);
      unit.remainingAP -= cost;
      
      if (G.actionQueue.length > 0 && G.actionQueue[0] === unit) G.actionQueue.shift();
      G.processedUnits.add(unit.id);
      
      postActionSettlement(unit);
      
      G.selectedSkill = null;
      G.selectedUnit = null;
      
      recalculateActionOrder();
      
      updateUI();
      
      if (checkBattleEnd()) return;
      
      G.phase = 'player_turn';
      G.currentActingUnit = null;
      
      if (G.actionQueue.length === 0) {
        endTurn();
      } else {
        setTimeout(() => processNextAction(), 500);
      }
    }
  }
};

document.getElementById('btn-manage-characters').onclick = () => {
  showCharacterManageModal();
};

document.getElementById('btn-close-skill-view').onclick = () => {
  const modal = document.getElementById('skill-view-modal');
  modal.classList.remove('show', 'positioned');
  const mc = modal.querySelector('.modal-content');
  resetModalContentStyles(mc);
};

document.getElementById('btn-confirm-learn').onclick = () => { confirmLearnSkill(); };
document.getElementById('btn-skip-learn').onclick = () => { skipLearnSkill(); };


const skillViewModal = document.getElementById('skill-view-modal');
if (skillViewModal) {
  skillViewModal.addEventListener('click', function(e) {
    if (e.target === this) {
      this.classList.remove('show', 'positioned');
      const mc = this.querySelector('.modal-content');
      resetModalContentStyles(mc);
    }
  });
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function(e) {
    if (e.target === this && !this.id.includes('gameover') && !this.id.includes('skill-learn')) {
      this.classList.remove('show');
      if (this.id === 'skill-modal') G.selectedUnit = null;
      else if (this.id === 'target-modal') {
        G.selectedSkill = null;
        G.selectedUnit = null;
      }
    }
  });
});

async function syncUnitToMvu(unit) {
    try {
        const variables = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
        let stat_data = _.get(variables, 'stat_data');
        if (!stat_data) return false;

        const found = findMvuEntity(stat_data, unit.name);
        if (!found) {
            console.warn(`无法找到 ${unit.name} 在 MVU 中的路径`);
            return false;
        }
        const path = found.path;

        if (unit.种族值) {
            _.set(stat_data, `${path}.$种族值.$体质种族值加值`, unit.种族值.体质种族值加值 || 0);
            _.set(stat_data, `${path}.$种族值.$智力种族值加值`, unit.种族值.智力种族值加值 || 0);
            _.set(stat_data, `${path}.$种族值.$防御种族值加值`, unit.种族值.防御种族值加值 || 0);
            _.set(stat_data, `${path}.$种族值.$敏捷种族值加值`, unit.种族值.敏捷种族值加值 || 0);
        }

        _.set(stat_data, `${path}.角色信息.等级与经验.当前等级`, unit.battleLevel);
        _.set(stat_data, `${path}.角色信息.等级与经验.当前经验`, unit.exp || 0);
        _.set(stat_data, `${path}.战斗信息.属性值.体力.当前值`, unit.hp.current);
        _.set(stat_data, `${path}.战斗信息.属性值.体力.上限`, unit.hp.max);
        _.set(stat_data, `${path}.战斗信息.属性值.精力.当前值`, unit.mp.current);
        _.set(stat_data, `${path}.战斗信息.属性值.精力.上限`, unit.mp.max);
        _.set(stat_data, `${path}.战斗信息.属性值.$物攻`, unit.atk?.base || 0);
        _.set(stat_data, `${path}.战斗信息.属性值.$魔攻`, unit.matk || 0);
        _.set(stat_data, `${path}.战斗信息.属性值.$防御`, unit.def || 0);
        _.set(stat_data, `${path}.战斗信息.属性值.$速度`, unit.spd || 0);

        await Mvu.replaceMvuData({ stat_data }, { type: 'message', message_id: getCurrentMessageId() });
        return true;
    } catch (e) {
        console.error('同步单位到MVU失败:', e);
        return false;
    }
}

async function initGame() {
  if (typeof waitGlobalInitialized === 'function') {
    await waitGlobalInitialized('Mvu');
  }

  addLog('正在加载游戏数据...', 'system');
  
  const { players, enemies } = await loadGameData();
  
  if (worldbookData.skills) {
    const resolvedPlayers = players.map(player => {
      const resolved = { ...player };
      
      if (resolved.skills && resolved.skills.length > 0) {
        resolved.skills = resolved.skills.map(skillName => {
          const skillObj = getSkillFromWorldbook(skillName);
          if (!skillObj) {
            addLog(`警告: 技能 "${skillName}" 未找到`, 'system');
            return { name: skillName, isBasicAttack: true };
          }
          return skillObj;
        });
      }
      
      if (resolved.learnedSkills && resolved.learnedSkills.length > 0) {
        resolved.learnedSkills = resolved.learnedSkills.map(skillName => {
          const skillObj = getSkillFromWorldbook(skillName);
          return skillObj || { name: skillName };
        }).filter(s => s !== null);
      }
      
      if (resolved.equippedSkills && resolved.equippedSkills.length > 0) {
        resolved.equippedSkills = resolved.equippedSkills.map(skillName => {
          const skillObj = getSkillFromWorldbook(skillName);
          return skillObj || { name: skillName };
        }).filter(s => s !== null);
      }
      
      return resolved;
    });
    
    window.loadedPlayers = resolvedPlayers;
    
    const resolvedEnemies = enemies.map(enemy => {
      const resolved = { ...enemy };
      
      if (resolved.skills && resolved.skills.length > 0) {
        resolved.skills = resolved.skills.map(skillName => {
          const skillObj = getSkillFromWorldbook(skillName);
          return skillObj || { name: skillName };
        }).filter(s => s !== null);
      }
      
      if (resolved.learnedSkills && resolved.learnedSkills.length > 0) {
        resolved.learnedSkills = resolved.learnedSkills.map(skillName => {
          const skillObj = getSkillFromWorldbook(skillName);
          return skillObj || { name: skillName };
        }).filter(s => s !== null);
      }
      
      if (resolved.equippedSkills && resolved.equippedSkills.length > 0) {
        resolved.equippedSkills = resolved.equippedSkills.map(skillName => {
          const skillObj = getSkillFromWorldbook(skillName);
          return skillObj || { name: skillName };
        }).filter(s => s !== null);
      }
      
      return resolved;
    });
    
    window.loadedEnemies = resolvedEnemies;
  } else {
    window.loadedPlayers = players;
    window.loadedEnemies = enemies;
  }

if (worldbookData.skills && Array.isArray(worldbookData.skills)) {
  if (!worldbookData.skills.some(s => s && s.name === '合体')) {
    worldbookData.skills.push({
      name: "合体",
      type: "fusion",
      targetType: "all_allies",
      actionType: "non_attack",
      cost: { mp: 30 },
      description: "选择2-6名队友合体成一个强大单位，继承所有技能和状态，属性总和*150%/人数，每回合可行动人数次。",
      fusionRange: [2, 6],
      effects: []
    });
  }
}
  
  showUnitSelection();
  addLog('请选择出场单位', 'system');
}

initGame();

(function setupFullscreen() {
  const fullscreenBtns = document.querySelectorAll('.fullscreen-btn, #fullscreen-btn');
  if (fullscreenBtns.length === 0) return;

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`全屏失败: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }

  fullscreenBtns.forEach(btn => {
    btn.addEventListener('click', toggleFullscreen);
  });

  document.addEventListener('fullscreenchange', () => {
    const isFullscreen = !!document.fullscreenElement;
    const icon = isFullscreen ? '✕' : '⛶';
    const bgColor = isFullscreen ? 'rgba(201, 68, 90, 0.8)' : 'rgba(0,0,0,0.6)';
    fullscreenBtns.forEach(btn => {
      btn.innerHTML = icon;
      btn.style.background = bgColor;
    });
  });
})();

