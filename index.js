const { Client, GatewayIntentBits, ChannelType, PermissionsBitField, REST, Routes, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

// Stockage des configurations de compteurs
const guildCounters = new Map();

// Configuration des permissions
const permConfig = new Map(); // guildId -> { perm1: [roles], perm2: [roles], perm3: [roles], perm4: [roles], owner: [roles] }

// ID super admin (accès à toutes les commandes)
const SUPER_ADMIN_ID = '1399234120214909010';

// Niveaux de permissions (ordre hiérarchique)
const PERM_LEVELS = {
  PERM1: 'perm1', // Niveau 1 (basique)
  PERM2: 'perm2', // Niveau 2 (inclut perm1)
  PERM3: 'perm3', // Niveau 3 (inclut perm1 + perm2)
  PERM4: 'perm4', // Niveau 4 (inclut perm1 + perm2 + perm3)
  OWNER: 'owner'  // Propriétaire (inclut tout)
};

// Mapping des commandes par niveau
const COMMAND_PERMS = {
  // Perm1
  clear: PERM_LEVELS.PERM1,
  lock: PERM_LEVELS.PERM1,
  unlock: PERM_LEVELS.PERM1,
  
  // Perm2
  hide: PERM_LEVELS.PERM2,
  unhide: PERM_LEVELS.PERM2,
  renew: PERM_LEVELS.PERM2,
  
  // Perm3
  baninfo: PERM_LEVELS.PERM3,
  blinfo: PERM_LEVELS.PERM3,
  
  // Perm4
  vc: PERM_LEVELS.PERM4,
  voc: PERM_LEVELS.PERM4,
  pic: PERM_LEVELS.PERM4,
  perms: PERM_LEVELS.PERM4,
  
  // Owner
  setup: PERM_LEVELS.OWNER,
  config: PERM_LEVELS.OWNER,
  savedb: PERM_LEVELS.OWNER,
  loaddb: PERM_LEVELS.OWNER
};

// Liste de toutes les commandes pour la config
const ALL_COMMANDS = [
  'clear', 'lock', 'unlock',
  'hide', 'unhide', 'renew',
  'baninfo', 'blinfo',
  'vc', 'voc', 'pic', 'perms',
  'setup', 'config', 'savedb', 'loaddb'
];

// Fonction pour vérifier les permissions (HIÉRARCHIQUE)
function hasPermission(member, commandName) {
  if (!member) return false;
  
  // SUPER ADMIN - accès à toutes les commandes sans restriction
  if (member.id === SUPER_ADMIN_ID) {
    return true;
  }
  
  // Owner du serveur a toutes les permissions
  if (member.id === member.guild.ownerId) return true;
  
  const guildPerms = permConfig.get(member.guild.id);
  if (!guildPerms) return false;
  
  const requiredLevel = COMMAND_PERMS[commandName];
  if (!requiredLevel) return false;
  
  // Vérifier tous les rôles de l'utilisateur
  const userRoleIds = member.roles.cache.map(r => r.id);
  
  // Convertir le niveau requis en valeur numérique pour comparaison
  const levelValue = {
    'perm1': 1,
    'perm2': 2,
    'perm3': 3,
    'perm4': 4,
    'owner': 5
  };
  
  const requiredValue = levelValue[requiredLevel];
  
  // Vérifier si l'utilisateur a un rôle d'un niveau suffisant (supérieur ou égal)
  for (const [level, roles] of Object.entries(guildPerms)) {
    const userHasRole = roles.some(roleId => userRoleIds.includes(roleId));
    if (userHasRole) {
      const userLevelValue = levelValue[level] || 0;
      if (userLevelValue >= requiredValue) {
        return true;
      }
    }
  }
  
  return false;
}

// Fonction pour sauvegarder la configuration
function saveConfigToFile() {
  const config = {
    guildCounters: Object.fromEntries(guildCounters),
    permConfig: Object.fromEntries(permConfig),
    savedAt: new Date().toISOString()
  };
  
  const fileName = `backup_${Date.now()}.json`;
  const filePath = path.join(__dirname, fileName);
  
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  return { filePath, fileName };
}

// Fonction pour charger la configuration depuis un fichier
async function loadConfigFromFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(data);
    
    // Restaurer guildCounters
    guildCounters.clear();
    for (const [key, value] of Object.entries(config.guildCounters || {})) {
      guildCounters.set(key, value);
    }
    
    // Restaurer permConfig
    permConfig.clear();
    for (const [key, value] of Object.entries(config.permConfig || {})) {
      permConfig.set(key, value);
    }
    
    return true;
  } catch (error) {
    console.error('Erreur lors du chargement de la configuration:', error);
    return false;
  }
}

// Fonction pour déployer les commandes
async function deployCommands() {
  try {
    const commands = [
      {
        name: 'setup',
        description: 'Configurer les compteurs vocaux',
        options: [
          {
            name: 'categorie',
            description: 'ID de la catégorie où créer les salons',
            type: 7,
            channel_types: [4],
            required: true
          },
          {
            name: 'compteur1',
            description: 'Nom du premier compteur',
            type: 3,
            required: false
          },
          {
            name: 'compteur2',
            description: 'Nom du deuxième compteur',
            type: 3,
            required: false
          },
          {
            name: 'compteur3',
            description: 'Nom du troisième compteur',
            type: 3,
            required: false
          },
          {
            name: 'compteur4',
            description: 'Nom du quatrième compteur',
            type: 3,
            required: false
          }
        ]
      }
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    
    console.log('Deploiement des commandes slash...');
    
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    
    console.log('Commandes deployees avec succes !');
  } catch (error) {
    console.error('Erreur lors du deploiement des commandes:', error);
  }
}

client.once('ready', async () => {
  console.log(`Bot connecte en tant que ${client.user.tag}`);
  console.log(`Serveurs: ${client.guilds.cache.size}`);
  console.log(`Super Admin ID: ${SUPER_ADMIN_ID}`);
  
  // Afficher les serveurs où le bot est présent
  client.guilds.cache.forEach(guild => {
    console.log(`- Serveur: ${guild.name} (ID: ${guild.id})`);
  });
  
  // Déployer les commandes au démarrage
  if (process.env.CLIENT_ID) {
    await deployCommands();
  } else {
    console.warn('CLIENT_ID non defini, ajoutez-le dans Railway pour deployer les commandes');
  }
  
  // Vérifier les configurations existantes
  console.log(`Configurations chargees: ${guildCounters.size} serveurs`);
  
  // Planifier la mise à jour toutes les 5 minutes
  cron.schedule('*/5 * * * *', () => {
    console.log('Mise a jour automatique des compteurs...');
    updateAllCounters();
  });
  
  // Première mise à jour après 10 secondes
  setTimeout(() => {
    console.log('Premiere mise a jour des compteurs...');
    updateAllCounters();
  }, 10000);
  
  // Vérification toutes les minutes pour le débogage
  setInterval(() => {
    console.log(`Stats: ${guildCounters.size} configurations actives`);
  }, 60000);
});

async function updateAllCounters() {
  console.log(`Debut de mise a jour pour ${guildCounters.size} configurations`);
  
  if (guildCounters.size === 0) {
    console.log('Aucune configuration trouvee, utilisez /setup d\'abord');
    return;
  }
  
  for (const [guildId, config] of guildCounters) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.log(`Serveur ${guildId} non trouve`);
      continue;
    }
    
    console.log(`Mise a jour pour ${guild.name} (${guildId})`);
    
    try {
      await updateGuildCounters(guild, config);
    } catch (error) {
      console.error(`Erreur pour ${guild.name}:`, error);
    }
  }
}

async function updateGuildCounters(guild, config) {
  try {
    console.log(`Recuperation des donnees pour ${guild.name}...`);
    
    // Récupérer les membres
    const members = await guild.members.fetch();
    const totalMembers = members.size;
    
    // Membres en ligne (online, idle, dnd)
    const onlineMembers = members.filter(m => {
      const status = m.presence?.status;
      return status === 'online' || status === 'idle' || status === 'dnd';
    }).size;
    
    // Membres en vocal
    const voiceMembers = members.filter(m => m.voice.channelId).size;
    
    // Membres en stream (CORRECTION)
    const streamingMembers = members.filter(m => {
      return m.voice.streaming === true; // Uniquement les vrais streams (partage d'écran)
    }).size;
    
    // Membres mute
    const mutedMembers = members.filter(m => {
      return m.voice.mute || m.voice.selfMute;
    }).size;
    
    // Nombre de boosts
    const boostCount = guild.premiumSubscriptionCount || 0;
    
    console.log(`Donnees pour ${guild.name}:`);
    console.log(`   - Total: ${totalMembers}`);
    console.log(`   - En ligne: ${onlineMembers}`);
    console.log(`   - En vocal: ${voiceMembers}`);
    console.log(`   - En stream: ${streamingMembers}`);
    console.log(`   - Mute: ${mutedMembers}`);
    console.log(`   - Boosts: ${boostCount}`);
    
    // PAS D'EMOJIS ICI
    const counters = [
      { name: config.counter1, value: `${totalMembers}`, index: 0 },
      { name: config.counter2, value: `${onlineMembers}`, index: 1 },
      { name: config.counter3, value: `${voiceMembers}`, index: 2 },
      { name: config.counter4, value: `${boostCount}`, index: 3 }
    ];
    
    console.log(`Salons configures: ${config.voiceChannels.length}`);
    
    for (let i = 0; i < config.voiceChannels.length; i++) {
      const channelId = config.voiceChannels[i];
      const channel = guild.channels.cache.get(channelId);
      
      if (!channel) {
        console.log(`Salon ${channelId} non trouve pour ${guild.name}`);
        continue;
      }
      
      if (counters[i]?.name) {
        const counterName = counters[i].name;
        const counterValue = counters[i].value;
        const newName = `${counterName} ${counterValue}`;
        
        console.log(`Salon ${i+1}: "${channel.name}" -> "${newName}"`);
        
        if (channel.name !== newName) {
          try {
            await channel.setName(newName);
            console.log(`Salon renomme avec succes`);
          } catch (error) {
            console.error(`Erreur renommage salon:`, error);
          }
        } else {
          console.log(`Pas de changement necessaire`);
        }
      }
    }
    
    console.log(`Mise a jour terminee pour ${guild.name}`);
    
  } catch (error) {
    console.error(`Erreur critique pour ${guild.name}:`, error);
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('-')) return;
  
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  
  // Vérifier les permissions
  if (!hasPermission(message.member, command)) {
    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#FFFFFF')
        .setDescription('Vous n\'avez pas les permissions nécessaires')
      ]
    });
  }
  
  // Commande savedb
  if (command === 'savedb') {
    try {
      const { filePath, fileName } = saveConfigToFile();
      
      await message.reply({
        content: 'Voici la sauvegarde de la configuration :',
        files: [{
          attachment: filePath,
          name: fileName
        }]
      });
      
      // Supprimer le fichier après l'envoi
      setTimeout(() => {
        fs.unlinkSync(filePath);
      }, 5000);
      
    } catch (error) {
      console.error('Erreur savedb:', error);
      message.reply('Erreur lors de la sauvegarde de la configuration.');
    }
  }
  
  // Commande loaddb
  if (command === 'loaddb') {
    if (message.attachments.size === 0) {
      return message.reply('Veuillez joindre un fichier de sauvegarde JSON.');
    }
    
    const attachment = message.attachments.first();
    if (!attachment.name.endsWith('.json')) {
      return message.reply('Le fichier doit être au format JSON.');
    }
    
    try {
      // Télécharger le fichier
      const response = await fetch(attachment.url);
      const fileContent = await response.text();
      const filePath = path.join(__dirname, `temp_${Date.now()}.json`);
      
      fs.writeFileSync(filePath, fileContent);
      
      // Charger la configuration
      const success = await loadConfigFromFile(filePath);
      
      // Supprimer le fichier temporaire
      fs.unlinkSync(filePath);
      
      if (success) {
        await message.reply('Configuration restaurée avec succès !');
        
        // Mettre à jour les compteurs immédiatement
        setTimeout(() => {
          updateAllCounters();
        }, 2000);
      } else {
        await message.reply('Erreur lors de la restauration de la configuration. Vérifiez que le fichier est valide.');
      }
      
    } catch (error) {
      console.error('Erreur loaddb:', error);
      message.reply('Erreur lors du chargement du fichier.');
    }
  }
  
  // Commande config (remplace set)
  if (command === 'config') {
    if (message.author.id !== message.guild.ownerId && message.author.id !== SUPER_ADMIN_ID) {
      return message.reply('Seul le propriétaire du serveur peut utiliser cette commande.');
    }
    
    const embed = new EmbedBuilder()
      .setColor('#FFFFFF')
      .setTitle('Configuration des permissions')
      .setDescription(
        'Sélectionnez un niveau de permission pour configurer les rôles qui y ont accès.\n\n' +
        '**Hiérarchie des permissions :**\n' +
        '• **Perm1** → Niveau basique\n' +
        '• **Perm2** → Inclut Perm1 + ses commandes\n' +
        '• **Perm3** → Inclut Perm1 + Perm2 + ses commandes\n' +
        '• **Perm4** → Inclut tous les niveaux inférieurs\n' +
        '• **Owner** → Propriétaire uniquement\n\n' +
        '**Commandes par niveau :**\n' +
        '• **Perm1** : clear, lock, unlock\n' +
        '• **Perm2** : hide, unhide, renew\n' +
        '• **Perm3** : baninfo, blinfo\n' +
        '• **Perm4** : vc, voc, pic, perms\n' +
        '• **Owner** : setup, config, savedb, loaddb'
      );
    
    const row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('config_select')
          .setPlaceholder('Choisir un niveau de permission')
          .addOptions([
            {
              label: 'Perm1',
              description: 'clear, lock, unlock',
              value: 'perm1',
            },
            {
              label: 'Perm2',
              description: 'hide, unhide, renew (inclut Perm1)',
              value: 'perm2',
            },
            {
              label: 'Perm3',
              description: 'baninfo, blinfo (inclut Perm1+2)',
              value: 'perm3',
            },
            {
              label: 'Perm4',
              description: 'vc, voc, pic, perms (inclut tout)',
              value: 'perm4',
            },
            {
              label: 'Owner',
              description: 'setup, config, savedb, loaddb',
              value: 'owner',
            }
          ])
      );
    
    const row2 = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('config_view')
          .setPlaceholder('Voir configuration actuelle')
          .addOptions([
            {
              label: 'Voir la configuration',
              description: 'Afficher les rôles configurés',
              value: 'view',
            },
            {
              label: 'Réinitialiser',
              description: 'Remettre à zéro',
              value: 'reset',
            }
          ])
      );
    
    message.channel.send({
      embeds: [embed],
      components: [row, row2]
    });
  }
  
  // Commande baninfo
  if (command === 'baninfo') {
    const userInput = args[0];
    if (!userInput) return message.reply('Veuillez spécifier un utilisateur (ID ou mention)');
    
    let userId = userInput.replace(/[<@!>]/g, '');
    
    try {
      const banInfo = await message.guild.bans.fetch(userId);
      const user = banInfo.user;
      const reason = banInfo.reason || 'Aucune raison fournie';
      
      const embed = new EmbedBuilder()
        .setColor('#FFFFFF')
        .setTitle(`Informations de bannissement de ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setDescription(`**Banni** : ${user.tag} | \`${user.id}\`\n**Banni par** : Inconnu | \`Inconnu\`\nIl y a X temps\n\n\`\`\`Raison : ${reason}\`\`\``);
      
      message.channel.send({ embeds: [embed] });
    } catch (error) {
      message.reply('Utilisateur non trouvé dans les bannissements ou ID invalide.');
    }
  }
  
  // Commande blinfo
  if (command === 'blinfo') {
    const userInput = args[0];
    if (!userInput) return message.reply('Veuillez spécifier un utilisateur (ID ou mention)');
    
    let userId = userInput.replace(/[<@!>]/g, '');
    
    const embed = new EmbedBuilder()
      .setColor('#FFFFFF')
      .setTitle(`Informations de blacklist de Utilisateur`)
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setDescription(`**Blacklister** : Utilisateur | \`${userId}\`\n**Blacklist par** : Inconnu | \`Inconnu\`\nIl y a X temps\n\n\`\`\`Raison : Aucune raison fournie\`\`\``);
    
    message.channel.send({ embeds: [embed] });
  }
  
  // Commande vc/voc (alias)
  if (command === 'vc' || command === 'voc') {
    const members = await message.guild.members.fetch();
    const totalMembers = members.size;
    const onlineMembers = members.filter(m => {
      const status = m.presence?.status;
      return status === 'online' || status === 'idle' || status === 'dnd';
    }).size;
    const voiceMembers = members.filter(m => m.voice.channelId).size;
    
    // CORRECTION: Uniquement les vrais streams
    const streamingMembers = members.filter(m => {
      return m.voice.streaming === true;
    }).size;
    
    const mutedMembers = members.filter(m => {
      return m.voice.mute || m.voice.selfMute;
    }).size;
    
    const embed = new EmbedBuilder()
      .setColor('#FFFFFF')
      .setTitle('__Aku\'Stats__ 🎐')
      .setThumbnail(message.guild.iconURL({ dynamic: true }))
      .setDescription(`Membres : **${totalMembers}**\nEn Ligne : **${onlineMembers}**\nEn Vocal : **${voiceMembers}**\nEn Stream : **${streamingMembers}**\nMute : **${mutedMembers}**`);
    
    await message.channel.send({ embeds: [embed] });
    await message.delete().catch(() => {});
  }
  
  // Commande clear
  if (command === 'clear') {
    const amount = parseInt(args[0]);
    const targetUser = message.mentions.users.first();
    
    if (targetUser) {
      const messages = await message.channel.messages.fetch({ limit: 100 });
      const userMessages = messages.filter(m => m.author.id === targetUser.id);
      const messagesToDelete = userMessages.first(amount || userMessages.size);
      
      for (const msg of messagesToDelete) {
        await msg.delete().catch(() => {});
      }
    } else {
      if (isNaN(amount) || amount < 1 || amount > 100) {
        return message.reply('Veuillez spécifier un nombre entre 1 et 100.');
      }
      
      await message.channel.bulkDelete(amount, true).catch(() => {});
    }
    
    await message.delete().catch(() => {});
  }
  
  // Commande renew
  if (command === 'renew') {
    const channel = message.channel;
    const channelName = channel.name;
    const channelPosition = channel.position;
    const channelParent = channel.parent;
    const channelTopic = channel.topic;
    const channelNSFW = channel.nsfw;
    const channelRateLimit = channel.rateLimitPerUser;
    const channelType = channel.type;
    
    // Sauvegarder les permissions
    const permissionOverwrites = channel.permissionOverwrites.cache.map(overwrite => ({
      id: overwrite.id,
      allow: overwrite.allow.bitfield,
      deny: overwrite.deny.bitfield,
      type: overwrite.type
    }));
    
    await channel.delete();
    
    // Créer le nouveau salon avec les mêmes paramètres
    const newChannel = await message.guild.channels.create({
      name: channelName,
      type: channelType,
      topic: channelTopic,
      nsfw: channelNSFW,
      parent: channelParent,
      rateLimitPerUser: channelRateLimit,
      position: channelPosition
    });
    
    // Restaurer toutes les permissions
    for (const perm of permissionOverwrites) {
      await newChannel.permissionOverwrites.create(perm.id, {
        allow: perm.allow,
        deny: perm.deny
      }).catch(() => {});
    }
    
    newChannel.send(`<@${message.author.id}> le salon a ete renew`);
  }
  
  // Commande lock
  if (command === 'lock') {
    await message.channel.permissionOverwrites.edit(message.guild.id, {
      SendMessages: false
    });
    
    message.channel.send(`Le salon #${message.channel.name} a bien ete **lock**`);
  }
  
  // Commande unlock
  if (command === 'unlock') {
    await message.channel.permissionOverwrites.edit(message.guild.id, {
      SendMessages: null
    });
    
    message.channel.send(`Le salon #${message.channel.name} a bien ete **unlock**`);
  }
  
  // Commande hide
  if (command === 'hide') {
    await message.channel.permissionOverwrites.edit(message.guild.id, {
      ViewChannel: false
    });
    
    message.channel.send(`Le salon #${message.channel.name} a bien ete **cacher**`);
  }
  
  // Commande unhide
  if (command === 'unhide') {
    await message.channel.permissionOverwrites.edit(message.guild.id, {
      ViewChannel: null
    });
    
    message.channel.send(`Le salon #${message.channel.name} n'est plus **cacher**`);
  }
  
  // Commande pic
  if (command === 'pic') {
    let user = message.mentions.users.first() || message.author;
    
    if (args[0] && !isNaN(args[0])) {
      try {
        user = await client.users.fetch(args[0]);
      } catch (e) {}
    }
    
    const embed = new EmbedBuilder()
      .setColor('#FFFFFF')
      .setTitle(`Photo de profil de ${user.tag}`)
      .setImage(user.displayAvatarURL({ dynamic: true, size: 4096 }));
    
    message.channel.send({ embeds: [embed] });
  }
  
  // Commande perms/perm
  if (command === 'perms' || command === 'perm') {
    const guildPerms = permConfig.get(message.guild.id) || {
      perm1: [],
      perm2: [],
      perm3: [],
      perm4: [],
      owner: [message.guild.ownerId]
    };
    
    const getCommandsForLevel = (level) => {
      return Object.entries(COMMAND_PERMS)
        .filter(([cmd, perm]) => perm === level)
        .map(([cmd]) => cmd)
        .join(' ');
    };
    
    const embed = new EmbedBuilder()
      .setColor('#FFFFFF')
      .setDescription(
        `**Hiérarchie des permissions** (les niveaux supérieurs incluent les inférieurs)\n\n` +
        `**Perm1**\n\`\`\`${getCommandsForLevel('perm1')}\`\`\`\n` +
        `**Perm2** (inclut Perm1)\n\`\`\`${getCommandsForLevel('perm2')}\`\`\`\n` +
        `**Perm3** (inclut Perm1+2)\n\`\`\`${getCommandsForLevel('perm3')}\`\`\`\n` +
        `**Perm4** (inclut tout)\n\`\`\`${getCommandsForLevel('perm4')}\`\`\`\n` +
        `**Owner**\n\`\`\`${getCommandsForLevel('owner')}\`\`\`\n\n` +
        `-# Voir \`-config\` pour configurer les rôles`
      );
    
    message.channel.send({ embeds: [embed] });
  }
});

// Gestion des interactions pour la configuration
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  
  if (interaction.customId === 'config_select') {
    if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== SUPER_ADMIN_ID) {
      return interaction.reply({
        content: 'Seul le propriétaire du serveur peut configurer les permissions.',
        ephemeral: true
      });
    }
    
    const permLevel = interaction.values[0];
    
    const filter = m => m.author.id === interaction.user.id;
    
    await interaction.reply({
      content: `Mentionnez les rôles à ajouter à **${permLevel.toUpperCase()}** (séparez par des espaces) :`,
      ephemeral: true
    });
    
    const collected = await interaction.channel.awaitMessages({
      filter,
      max: 1,
      time: 60000,
      errors: ['time']
    }).catch(() => null);
    
    if (!collected) {
      return interaction.followUp({
        content: 'Temps écoulé. Configuration annulée.',
        ephemeral: true
      });
    }
    
    const response = collected.first();
    const roleMentions = response.mentions.roles;
    
    if (roleMentions.size === 0) {
      return interaction.followUp({
        content: 'Aucun rôle valide mentionné. Configuration annulée.',
        ephemeral: true
      });
    }
    
    // Sauvegarder la configuration
    const guildPerms = permConfig.get(interaction.guild.id) || {
      perm1: [],
      perm2: [],
      perm3: [],
      perm4: [],
      owner: [interaction.guild.ownerId]
    };
    
    guildPerms[permLevel] = roleMentions.map(r => r.id);
    permConfig.set(interaction.guild.id, guildPerms);
    
    await response.delete();
    
    interaction.followUp({
      content: `Configuration mise à jour : **${permLevel.toUpperCase()}** peut maintenant être utilisé par ${roleMentions.map(r => r.toString()).join(' ')}`,
      ephemeral: true
    });
  }
  
  if (interaction.customId === 'config_view') {
    if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== SUPER_ADMIN_ID) {
      return interaction.reply({
        content: 'Seul le propriétaire du serveur peut configurer les permissions.',
        ephemeral: true
      });
    }
    
    const action = interaction.values[0];
    
    if (action === 'view') {
      const guildPerms = permConfig.get(interaction.guild.id) || {
        perm1: [],
        perm2: [],
        perm3: [],
        perm4: [],
        owner: [interaction.guild.ownerId]
      };
      
      const embed = new EmbedBuilder()
        .setColor('#FFFFFF')
        .setTitle('Configuration actuelle')
        .setDescription(
          `**Perm1** : ${guildPerms.perm1.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\n` +
          `**Perm2** (inclut Perm1) : ${guildPerms.perm2.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\n` +
          `**Perm3** (inclut Perm1+2) : ${guildPerms.perm3.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\n` +
          `**Perm4** (inclut tout) : ${guildPerms.perm4.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\n` +
          `**Owner** : ${guildPerms.owner.map(id => id === interaction.guild.ownerId ? 'Propriétaire' : `<@&${id}>`).join(' ') || 'Propriétaire uniquement'}`
        );
      
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    if (action === 'reset') {
      permConfig.delete(interaction.guild.id);
      return interaction.reply({
        content: 'Configuration réinitialisée. Toutes les permissions sont maintenant réservées au propriétaire.',
        ephemeral: true
      });
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  
  const { commandName, options, user, guild } = interaction;
  
  if (commandName === 'setup') {
    console.log(`Commande setup recue de ${user.tag} sur ${guild?.name}`);
    
    // Vérifier si l'utilisateur est le propriétaire du serveur ou super admin
    if (user.id !== guild.ownerId && user.id !== SUPER_ADMIN_ID) {
      console.log(`${user.tag} n'est pas proprietaire ni super admin`);
      return interaction.reply({
        content: 'Seul le proprietaire du serveur peut utiliser cette commande !',
        ephemeral: true
      });
    }
    
    const category = options.getChannel('categorie');
    const counter1 = options.getString('compteur1');
    const counter2 = options.getString('compteur2');
    const counter3 = options.getString('compteur3');
    const counter4 = options.getString('compteur4');
    
    console.log(`Parametres:`, {
      categorie: category?.id,
      counter1, counter2, counter3, counter4
    });
    
    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.reply({
        content: 'Veuillez specifier une categorie valide !',
        ephemeral: true
      });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      // Supprimer les anciens salons vocaux
      const existingConfig = guildCounters.get(guild.id);
      if (existingConfig) {
        console.log(`Suppression des anciens salons...`);
        for (const channelId of existingConfig.voiceChannels) {
          const channel = guild.channels.cache.get(channelId);
          if (channel) {
            await channel.delete();
            console.log(`Salon ${channelId} supprime`);
          }
        }
      }
      
      // Créer les nouveaux salons vocaux
      const voiceChannels = [];
      const counters = [counter1, counter2, counter3, counter4].filter(c => c);
      
      console.log(`Creation de ${counters.length} salons...`);
      
      for (let i = 0; i < counters.length; i++) {
        const counter = counters[i];
        
        console.log(`Creation salon ${i+1}: ${counter}`);
        
        const channel = await guild.channels.create({
          name: `${counter} ...`,
          type: ChannelType.GuildVoice,
          parent: category.id,
          permissionOverwrites: [
            {
              id: guild.id,
              deny: [PermissionsBitField.Flags.Connect]
            }
          ]
        });
        
        voiceChannels.push(channel.id);
        console.log(`Salon cree: ${channel.id}`);
      }
      
      // Sauvegarder la configuration
      guildCounters.set(guild.id, {
        counter1,
        counter2,
        counter3,
        counter4,
        voiceChannels,
        categoryId: category.id
      });
      
      console.log(`Configuration sauvegardee pour ${guild.name}`);
      
      // Message de confirmation
      let confirmMessage = `${voiceChannels.length} compteurs vocaux crees !\n\nConfiguration :\n`;
      
      if (counter1) confirmMessage += `- ${counter1} : Membres totaux\n`;
      if (counter2) confirmMessage += `- ${counter2} : Membres en ligne\n`;
      if (counter3) confirmMessage += `- ${counter3} : Membres en vocal\n`;
      if (counter4) confirmMessage += `- ${counter4} : Boosts\n`;
      
      confirmMessage += `\nMise a jour automatique toutes les 5 minutes`;
      
      await interaction.editReply({
        content: confirmMessage
      });
      
      // Mise à jour immédiate
      console.log(`Mise a jour immediate...`);
      await updateGuildCounters(guild, guildCounters.get(guild.id));
      
    } catch (error) {
      console.error('ERREUR SETUP:', error);
      await interaction.editReply({
        content: 'Erreur: ' + error.message
      });
    }
  }
});

// Écouter les événements pour mettre à jour plus rapidement
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (oldState.channelId !== newState.channelId) {
    console.log(`Changement vocal detecte sur ${newState.guild.name}`);
    setTimeout(() => {
      updateAllCounters();
    }, 3000);
  }
});

// Gestion des erreurs
client.on('error', console.error);
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

// Connexion avec le token Railway
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error('Token Discord manquant !');
  console.error('Ajoutez TOKEN dans les variables d\'environnement Railway');
  process.exit(1);
}

console.log('Demarrage du bot...');
client.login(TOKEN);