// Races: each side fields one. A race renames and re-skins every building and unit (see the race model
// files under js/models/) and carries a small stat identity. Gameplay roles stay the same across races.
(function (G) {
  // mods: hp / dmg / speed / cd multiply each soldier's stats; bhp multiplies building hp (not the
  // Command Center); slowImmune units ignore slows. shotFx colors tower/unit shot trails and impacts.
  G.RACES = [
    {
      id: 'human', name: 'Human', color: '#c9a25a',
      desc: 'Frosthaven settlers. Timber, stone and steel. Disciplined: units attack 15% faster.',
      trait: 'Disciplined',
      mods: { hp: 1, dmg: 1, speed: 1, cd: 0.87, bhp: 1 },
      shotFx: { trail: '#ffb050', impact: '#e9dcc2' },
      buildings: {
        command: 'Frosthaven Keep', hut: 'Timber Hut', digin: 'Palisade Dig-in', support: 'Crossbow Watchtower',
        siege: 'Catapult', storm: 'Storm Spire', barracks: 'Guard Barracks', barracksArmored: 'Armory Hall',
        barracksShort: 'Skirmisher Camp', barracksLong: 'Archery Range', allyEngineer: 'Engineer Lodge',
        allyMedic: 'Medic Tent', allyOfficer: 'Officer Quarters', allyDemolitionist: 'Demolitionist Workshop'
      },
      units: {
        infantry: 'Footmen', armored: 'Men-at-Arms', short: 'Skirmishers', long: 'Longbowmen',
        engineer: 'Engineer', medic: 'Field Medic', officer: 'Captain', demolitionist: 'Demolitionist'
      }
    },
    {
      id: 'algox', name: 'Algox', color: '#9fd4ea',
      desc: 'Towering snow-folk of the northern crags. Hide, bone and living ice. Hulking: units +30% health, 10% slower.',
      trait: 'Hulking',
      mods: { hp: 1.3, dmg: 1, speed: 0.9, cd: 1, bhp: 1 },
      shotFx: { trail: '#bfe9ff', impact: '#dff4ff' },
      buildings: {
        command: 'Great Clan Hall', hut: 'Hide Yurt', digin: 'Snow Burrow', support: 'Icicle Spire',
        siege: 'Glacier Hurler', storm: 'Blizzard Totem', barracks: 'Clan Longhouse', barracksArmored: 'Tusk Forge',
        barracksShort: "Hunter's Den", barracksLong: 'Stalker Lodge', allyEngineer: "Ice Carver's Hut",
        allyMedic: 'Shaman Hut', allyOfficer: "Chieftain's Throne", allyDemolitionist: 'Avalanche Cairn'
      },
      units: {
        infantry: 'Brutes', armored: 'Tusk Guard', short: 'Javelin Hunters', long: 'Icebow Stalkers',
        engineer: 'Ice Carver', medic: 'Snow Shaman', officer: 'War Chief', demolitionist: 'Avalanche Caller'
      }
    },
    {
      id: 'lurker', name: 'Lurker', color: '#3fc0c8',
      desc: 'Crab-folk risen from the frozen deep. Coral, shell and brine. Relentless Tide: units 15% faster, +10% damage.',
      trait: 'Relentless Tide',
      mods: { hp: 1, dmg: 1.1, speed: 1.15, cd: 1, bhp: 1 },
      shotFx: { trail: '#5fe0d8', impact: '#9ff0ea' },
      buildings: {
        command: 'Abyssal Reef Throne', hut: 'Tide Shell', digin: 'Reef Trench', support: 'Spine Coral',
        siege: 'Brine Mortar', storm: 'Maelstrom Pool', barracks: 'Spawning Pool', barracksArmored: 'Carapace Grotto',
        barracksShort: 'Spine Den', barracksLong: 'Harpoon Reef', allyEngineer: 'Coral Nursery',
        allyMedic: 'Tidal Font', allyOfficer: "Warden's Spire", allyDemolitionist: 'Ink Grotto'
      },
      units: {
        infantry: 'Claw Warriors', armored: 'Shellbreakers', short: 'Spine Throwers', long: 'Harpooneers',
        engineer: 'Coral Shaper', medic: 'Tide Healer', officer: 'Reef Warden', demolitionist: 'Ink Bomber'
      }
    },
    {
      id: 'unfettered', name: 'Unfettered', color: '#e0a040',
      desc: 'Self-made automatons of brass and lightning. Mechanical: buildings +25% health, units ignore slows.',
      trait: 'Mechanical',
      mods: { hp: 1, dmg: 1, speed: 1, cd: 1, bhp: 1.25, slowImmune: true },
      shotFx: { trail: '#7fe8ff', impact: '#c8f6ff' },
      buildings: {
        command: 'Prime Core', hut: 'Power Cell', digin: 'Sentry Nest', support: 'Arc Turret',
        siege: 'Mortar Engine', storm: 'Aegis Pylon', barracks: 'Assembly Line', barracksArmored: 'Heavy Foundry',
        barracksShort: 'Rivet Works', barracksLong: 'Calibration Spire', allyEngineer: 'Repair Bay',
        allyMedic: 'Coolant Station', allyOfficer: 'Command Node', allyDemolitionist: 'Munitions Works'
      },
      units: {
        infantry: 'Automatons', armored: 'Juggernauts', short: 'Rivet Gunners', long: 'Rangefinders',
        engineer: 'Repair Bot', medic: 'Mender Unit', officer: 'Overseer', demolitionist: 'Bombardier'
      }
    }
  ];

  const byId = {};
  for (const r of G.RACES) byId[r.id] = r;
  G.raceById = id => byId[id] || byId.human;

  // Which race each team plays. Set from the match config before the world is built (see main.js).
  G.teamRace = { [G.TEAM.PLAYER]: 'human', [G.TEAM.ENEMY]: 'algox' };
  G.raceOf = team => G.teamRace[team] || 'human';
  G.raceDef = team => G.raceById(G.raceOf(team));
  const NO_MODS = { hp: 1, dmg: 1, speed: 1, cd: 1, bhp: 1 };
  G.raceMods = team => (team === G.TEAM.PLAYER || team === G.TEAM.ENEMY ? G.raceDef(team).mods : NO_MODS);

  // Per-match handicaps, set from the single player difficulty (see ai.js). troopDmg multiplies the damage
  // of a team's soldiers (trained and summoned); gold multiplies the coins its hero picks up.
  const NO_BONUS = { troopDmg: 1, gold: 1 };
  G.teamBonus = { [G.TEAM.PLAYER]: NO_BONUS, [G.TEAM.ENEMY]: NO_BONUS };
  G.bonusOf = team => G.teamBonus[team] || NO_BONUS;

  G.buildingName = (type, team) => G.raceDef(team).buildings[type] || G.BUILDINGS[type].name;
  G.unitName = (kind, team) => G.raceDef(team).units[kind] || kind;
})(window.Game);
