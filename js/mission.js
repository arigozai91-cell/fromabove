/* =============================================
   MISSION.JS — Mission objectives & wave system
   ============================================= */
'use strict';

const MissionSystem = (() => {

  const RADIO_LINES = [
    'Spectre, you are cleared hot on all targets.',
    'Good hit, good hit. Keep it coming.',
    'Watch your fire, we have friendlies in the area.',
    'Target acquired. Engage at will.',
    'Multiple movers spotted south of the convoy.',
    'Hotel November, this is Ghostrider. Fire mission ready.',
    'Confirmed kill. Nice shooting, Spectre.',
    'Reloading, standby.',
    'Convoy is taking fire, get those vehicles!',
    'Command, we have eyes on priority targets.',
    'Break break — hostile armour moving on your six.',
    'Cleared to engage. No friendlies within 200 meters.',
    'Spectre, be advised: heat sources to the north.',
    'All units hold position. Spectre is working.'
  ];

  const PRESTIGE_REWARDS = {
    infantry: 10,
    machineGunner: 14,
    antiTank: 18,
    truck: 20,
    apc: 35,
    tank: 50,
    bunker: 35,
    bofors: 45,
    artillery: 60,
    default: 10
  };

  const MISSION_DEFS = [
    {
      id: 1,
      name: 'LAST STAND',
      description: 'Protect the squad holding the compound. Survive 3 minutes.',
      objective: 'DEFEND THE COMPOUND — KEEP FRIENDLIES ALIVE FOR 3:00',
      infantryCount: 20,
      vehicleCount: 5,
      friendlyInfantry: 6,
      friendlyVehicles: 2,
      friendlyApcs: 1,
      targetKills: null,          // kill count does not win this mission
      timeLimitSec: 180,          // 3-minute timer
      holdMode: true,             // special: survive timer, fail if all friendlies die
      bonusPerFriendlySaved: 25
    },
    {
      id: 2,
      name: 'CONVOY INTERCEPT',
      description: 'Enemy convoy moving through sector. Destroy all vehicles and escort before they reach the extraction zone.',
      objective: 'DESTROY THE CONVOY — ELIMINATE 20+ ENEMIES',
      infantryCount: 14,
      vehicleCount: 6,
      friendlyInfantry: 0,
      friendlyVehicles: 0,
      targetKills: 20,
      timeLimitSec: null,
      convoyMode: true,
      bonusPerFriendlySaved: 0
    },
    {
      id: 3,
      name: 'DEAD WAVE',
      description: 'Undead forces breach the perimeter. Five waves of infected soldiers converge on your position.',
      objective: 'SURVIVE ALL 5 WAVES — PROTECT THE SQUAD',
      infantryCount: 0,
      vehicleCount: 0,
      friendlyInfantry: 8,
      friendlyVehicles: 0,
      targetKills: null,
      timeLimitSec: null,
      zombieWaveMode: true,
      bonusPerFriendlySaved: 18
    }
  ];

  let currentMission = null;
  let missionIndex = 0;
  let score = 0;
  let kills = 0;
  let friendlyKills = 0;
  let missionStartTime = 0;
  let missionComplete = false;
  let lastRadioTime = 0;
  let reinforcementTimer = 0;

  let nextRadioTime = 0;

  // Zombie wave state (DEAD WAVE mission)
  let _zombieWaveIndex = 0;
  let _zombieWaveTimer = 0;
  let _zombieWaveState = 'idle'; // 'idle' | 'countdown' | 'active' | 'done'
  const ZOMBIE_WAVES = [20, 30, 45, 68, 102];

  function startMission(index, time, overrideDef) {
    if (overrideDef) {
      // Custom editor mission
      missionIndex = -1;
      currentMission = { ...overrideDef };
    } else {
      missionIndex = index % MISSION_DEFS.length;
      currentMission = { ...MISSION_DEFS[missionIndex] };
    }
    score = 0;
    kills = 0;
    friendlyKills = 0;
    missionStartTime = time;
    missionComplete = false;
    lastRadioTime = time + 3;
    nextRadioTime  = time + 3 + Utils.randFloat(18, 35);
    reinforcementTimer = 30;
    HUDSystem.updateObjective(currentMission.objective);
    HUDSystem.updateScore(score, kills);
    // Reset zombie wave state
    _zombieWaveIndex = 0;
    _zombieWaveTimer = currentMission.zombieWaveMode ? 8 : 0;
    _zombieWaveState = currentMission.zombieWaveMode ? 'countdown' : 'idle';
    return currentMission;
  }

  function getMissionDef(index) {
    return MISSION_DEFS[index % MISSION_DEFS.length];
  }

  function addScore(amount) {
    const payout = Math.max(0, Math.round(Number(amount) || 0));
    if (!payout) return;
    score += payout;
    if (typeof WeaponsSystem !== 'undefined' && WeaponsSystem.awardPrestige) {
      WeaponsSystem.awardPrestige(payout);
    }
    HUDSystem.updateScore(score, kills);
  }

  function getPrestigeReward(entity) {
    if (!entity) return PRESTIGE_REWARDS.default;
    if (entity.type === 'infantry') {
      if (entity.infantryRole === 'machineGunner') return PRESTIGE_REWARDS.machineGunner;
      if (entity.infantryRole === 'antiTank') return PRESTIGE_REWARDS.antiTank;
      return PRESTIGE_REWARDS.infantry;
    }
    if (entity.type === 'vehicle') {
      if (entity.vehicleSubtype === 'tank') return PRESTIGE_REWARDS.tank;
      if (entity.vehicleSubtype === 'apc') return PRESTIGE_REWARDS.apc;
      return PRESTIGE_REWARDS.truck;
    }
    if (entity.type === 'staticStructure') {
      if (entity.structureType === 'artillery') return PRESTIGE_REWARDS.artillery;
      if (entity.structureType === 'bofors') return PRESTIGE_REWARDS.bofors;
      return PRESTIGE_REWARDS.bunker;
    }
    return PRESTIGE_REWARDS.default;
  }

  function recordKill(entity) {
    if (!entity.hostile) {
      friendlyKills++;
      HUDSystem.addKillFeed('!! FRIENDLY FIRE !!', true);
      HUDSystem.setWarning('FRIENDLY FIRE!');
      setTimeout(() => HUDSystem.setWarning(''), 2500);
    } else {
      kills++;
      const base = getPrestigeReward(entity);
      addScore(base);
      const typeStr = entity.type === 'vehicle'
        ? `▣ VEHICLE DESTROYED +${base} PRESTIGE`
        : entity.type === 'staticStructure'
          ? `■ STRUCTURE DESTROYED +${base} PRESTIGE`
          : `✕ TARGET NEUTRALIZED +${base} PRESTIGE`;
      HUDSystem.addKillFeed(typeStr);
    }
    HUDSystem.updateScore(score, kills);
  }

  function countAliveFriendlies(entities) {
    return (entities || []).filter(e => !e.hostile && e.alive && e.type !== 'staticStructure').length;
  }

  function checkComplete(entities) {
    if (missionComplete) return false;
    if (!currentMission) return false;

    // Hold mode: win condition is timer expiry with at least 1 friendly alive (checked externally)
    if (currentMission.holdMode) return false;

    // Zombie wave mode: win when all waves are cleared
    if (currentMission.zombieWaveMode) {
      if (_zombieWaveState === 'done') {
        missionComplete = true;
        return true;
      }
      return false;
    }

    // Escort mode: win when at least 1 friendly reaches the last waypoint
    if (currentMission.escortMode) {
      const arrived = (entities || []).filter(e => !e.hostile && e.waypointReachedLast).length;
      if (arrived > 0) {
        missionComplete = true;
        return true;
      }
      return false;
    }

    if (currentMission.targetKills && kills >= currentMission.targetKills) {
      missionComplete = true;
      return true;
    }
    return false;
  }

  function checkFail(entities) {
    if (missionComplete || !currentMission) return false;
    if (currentMission.holdMode || currentMission.zombieWaveMode || currentMission.escortMode) {
      const friendliesAlive = countAliveFriendlies(entities);
      if (friendliesAlive === 0) {
        missionComplete = true;
        return true;
      }
    }
    return false;
  }

  function checkTimerWin(time, entities) {
    if (missionComplete || !currentMission || !currentMission.holdMode) return false;
    const elapsed = time - missionStartTime;
    if (elapsed >= currentMission.timeLimitSec) {
      const friendliesAlive = countAliveFriendlies(entities);
      if (friendliesAlive > 0) {
        missionComplete = true;
        addScore(friendliesAlive * currentMission.bonusPerFriendlySaved);
        return true;
      }
    }
    return false;
  }

  function getTimeRemaining(time) {
    if (!currentMission || !currentMission.timeLimitSec) return null;
    return Math.max(0, currentMission.timeLimitSec - (time - missionStartTime));
  }

  function update(dt, time, entities, scene) {
    if (!currentMission || missionComplete) return;

    // Periodic radio chatter
    if (time >= nextRadioTime) {
      const line = RADIO_LINES[Math.floor(Math.random() * RADIO_LINES.length)];
      HUDSystem.showRadio(line);
      lastRadioTime  = time;
      nextRadioTime  = time + Utils.randFloat(18, 35);
    }

    // Reinforcement spawning (skip for zombie wave mode and custom editor missions)
    if (!currentMission.zombieWaveMode && missionIndex !== -1) {
      reinforcementTimer -= dt;
      if (reinforcementTimer <= 0) {
        reinforcementTimer = 20 + missionIndex * 5;
        if (missionIndex === 0) {
          // Mission 1: reinforce with exactly 1 vehicle + 4 soldiers arriving as a group
          EntitySystem.addReinforceGroup(4);
        } else {
          const count = Utils.randInt(2, 4);
          for (let i = 0; i < count; i++) {
            EntitySystem.addHostileInfantry();
          }
          if (missionIndex > 0 && Math.random() < 0.3) {
            EntitySystem.addHostileVehicle();
          }
        }
      }
    }

    // Zombie wave logic (DEAD WAVE mission)
    if (currentMission.zombieWaveMode && _zombieWaveState !== 'idle' && _zombieWaveState !== 'done') {
      if (_zombieWaveState === 'countdown') {
        _zombieWaveTimer -= dt;
        const waveNum = _zombieWaveIndex + 1;
        HUDSystem.updateObjective(`WAVE ${waveNum} / ${ZOMBIE_WAVES.length} — INCOMING IN ${Math.ceil(_zombieWaveTimer)}s`);
        if (_zombieWaveTimer <= 0) {
          const count = ZOMBIE_WAVES[_zombieWaveIndex];
          EntitySystem.addZombieWave(count);
          HUDSystem.showRadio(`WAVE ${waveNum} — ${count} INFECTED INCOMING`);
          HUDSystem.updateObjective(`WAVE ${waveNum} / ${ZOMBIE_WAVES.length} — REPEL THE HORDE`);
          _zombieWaveState = 'active';
        }
      } else if (_zombieWaveState === 'active') {
        const hostiles = entities.filter(e => e.hostile && e.alive);
        if (hostiles.length === 0) {
          _zombieWaveIndex++;
          if (_zombieWaveIndex >= ZOMBIE_WAVES.length) {
            _zombieWaveState = 'done';
            HUDSystem.showRadio('All waves repelled. Outstanding work, Spectre.');
            HUDSystem.updateObjective('ALL WAVES REPELLED — MISSION COMPLETE');
          } else {
            _zombieWaveState = 'countdown';
            _zombieWaveTimer = 15;
            HUDSystem.showRadio(`Wave ${_zombieWaveIndex} cleared. Reinforcements inbound. Next wave in 15 seconds.`);
            HUDSystem.updateObjective(`WAVE ${_zombieWaveIndex} CLEARED — BRACE FOR NEXT`);
            // Spawn 1 patrol truck + 3 soldiers as enemy reinforcements
            EntitySystem.addWaveReinforcements();
          }
        }
      }
    }
  }

  function getScore() { return score; }
  function getKills() { return kills; }
  function getFriendlyKills() { return friendlyKills; }
  function getCurrentMission() { return currentMission; }
  function getMissionCount() { return MISSION_DEFS.length; }
  function getMissionStartTime() { return missionStartTime; }

  return {
    startMission, getMissionDef,
    addScore, recordKill, checkComplete, checkFail, checkTimerWin, getTimeRemaining, update,
    getScore, getKills, getFriendlyKills,
    getCurrentMission, getMissionCount, getMissionStartTime
  };
})();
