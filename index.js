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

// ID du serveur principal (pour les bans/blacklist)
const SERVEUR_PRINCIPAL_ID = '1466260834190758106';

// Stockage des configurations de compteurs
const guildCounters = new Map();

// Configuration des permissions
const permConfig = new Map(); // guildId -> { perm1: [roles], perm2: [roles], perm3: [roles], perm4: [roles], owner: [roles] }

// Configuration des commandes par niveau (personnalisable)
const commandsConfig = new Map(); // guildId -> { perm1: [commandes], perm2: [commandes], etc. }

// ID super admin (accès à toutes les commandes)
const SUPER_ADMIN_ID = '1399234120214909010';

// Niveaux de permissions
const PERM_LEVELS = {
  PERM1: 'perm1',
  PERM2: 'perm2',
  PERM3: 'perm3',
  PERM4: 'perm4',
  OWNER: 'owner'
};

// Commandes disponibles
const AVAILABLE_COMMANDS = [
  'clear', 'lock', 'unlock',
  'hide', 'unhide', 'renew',
  'baninfo', 'blinfo',
  'vc', 'voc', 'pic', 'perms',
  'setup', 'config', 'savedb', 'loaddb'
];

// Commandes par défaut
const DEFAULT_COMMANDS = {
  perm1: ['clear', 'lock', 'unlock'],
  perm2: ['hide', 'unhide', 'renew'],
  perm3: ['baninfo', 'blinfo'],
  perm4: ['vc', 'voc', 'pic', 'perms'],
  owner: ['setup', 'config', 'savedb', 'loaddb']
};

// Fonction pour vérifier les permissions
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
  
  // Récupérer la configuration des commandes pour ce serveur
  const guildCommands = commandsConfig.get(member.guild.id) || DEFAULT_COMMANDS;
  
  // Vérifier tous les rôles de l'utilisateur
  const userRoleIds = member.roles.cache.map(r => r.id);
  
  // Vérifier chaque niveau de permission
  for (const [level, roles] of Object.entries(guildPerms)) {
    const userHasRole = roles.some(roleId => userRoleIds.includes(roleId));
    if (userHasRole) {
      // Si l'utilisateur a ce niveau, vérifier si la commande est dans ce niveau
      const levelCommands = guildCommands[level] || [];
      if (levelCommands.includes(commandName)) {
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
    commandsConfig: Object.fromEntries(commandsConfig),
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
    
    // Restaurer commandsConfig
    commandsConfig.clear();
    for (const [key, value] of Object.entries(config.commandsConfig || {})) {
      commandsConfig.set(key, value);
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
  console.log(`Serveur Principal ID: ${SERVEUR_PRINCIPAL_ID}`);
  
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
    
    // Membres en stream
    const streamingMembers = members.filter(m => {
      return m.voice.streaming === true;
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
    
    // PAS D'EMOJIS
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
  
  // Commande config
  if (command === 'config') {
    if (message.author.id !== message.guild.ownerId && message.author.id !== SUPER_ADMIN_ID) {
      return message.reply('Seul le propriétaire du serveur peut utiliser cette commande.');
    }
    
    const embed = new EmbedBuilder()
      .setColor('#FFFFFF')
      .setTitle('Configuration des permissions')
      .setDescription(
        '**Configuration des roles**\n' +
        'Selectionnez un niveau pour attribuer des roles :\n\n' +
        '• **Perm1** : clear, lock, unlock\n' +
        '• **Perm2** : hide, unhide, renew\n' +
        '• **Perm3** : baninfo, blinfo\n' +
        '• **Perm4** : vc, voc, pic, perms\n' +
        '• **Owner** : setup, config, savedb, loaddb\n\n' +
        '**Configuration des commandes**\n' +
        'Selectionnez un niveau pour personnaliser ses commandes'
      );
    
    const row1 = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('config_roles')
          .setPlaceholder('Configurer les roles')
          .addOptions([
            {
              label: 'Perm1',
              description: 'clear, lock, unlock',
              value: 'roles_perm1',
            },
            {
              label: 'Perm2',
              description: 'hide, unhide, renew',
              value: 'roles_perm2',
            },
            {
              label: 'Perm3',
              description: 'baninfo, blinfo',
              value: 'roles_perm3',
            },
            {
              label: 'Perm4',
              description: 'vc, voc, pic, perms',
              value: 'roles_perm4',
            },
            {
              label: 'Owner',
              description: 'setup, config, savedb, loaddb',
              value: 'roles_owner',
            }
          ])
      );
    
    const row2 = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('config_commands')
          .setPlaceholder('Configurer les commandes')
          .addOptions([
            {
              label: 'Perm1',
              description: 'Modifier les commandes du niveau 1',
              value: 'cmd_perm1',
            },
            {
              label: 'Perm2',
              description: 'Modifier les commandes du niveau 2',
              value: 'cmd_perm2',
            },
            {
              label: 'Perm3',
              description: 'Modifier les commandes du niveau 3',
              value: 'cmd_perm3',
            },
            {
              label: 'Perm4',
              description: 'Modifier les commandes du niveau 4',
              value: 'cmd_perm4',
            },
            {
              label: 'Owner',
              description: 'Modifier les commandes du proprietaire',
              value: 'cmd_owner',
            }
          ])
      );
    
    const row3 = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('config_view')
          .setPlaceholder('Options')
          .addOptions([
            {
              label: 'Voir configuration',
              description: 'Afficher les roles et commandes actuels',
              value: 'view',
            },
            {
              label: 'Reinitialiser',
              description: 'Remettre a zero',
              value: 'reset',
            }
          ])
      );
    
    message.channel.send({
      embeds: [embed],
      components: [row1, row2, row3]
    });
  }
  
  // Commande baninfo
  if (command === 'baninfo') {
    const userInput = args[0];
    if (!userInput) return message.reply('Veuillez specifier un utilisateur (ID ou mention)');
    
    let userId = userInput.replace(/[<@!>]/g, '');
    
    try {
      // Récupérer le serveur principal
      const serveurPrincipal = client.guilds.cache.get(SERVEUR_PRINCIPAL_ID);
      if (!serveurPrincipal) {
        return message.reply('Erreur');
      }
      
      // Chercher les bans sur le serveur principal
      const banInfo = await serveurPrincipal.bans.fetch(userId);
      const user = banInfo.user;
      const reason = banInfo.reason || 'Aucune raison fournie';
      
      // Récupérer les logs d'audit sur le serveur principal
      const auditLogs = await serveurPrincipal.fetchAuditLogs({
        type: 22,
        limit: 10
      });
      
      const banLog = auditLogs.entries.find(entry => entry.target.id === userId);
      
      let banniPar = 'Inconnu';
      let banniParId = 'Inconnu';
      let temps = 'inconnu';
      
      if (banLog) {
        banniPar = banLog.executor;
        banniParId = banLog.executor.id;
        
        // Calculer le temps écoulé
        const maintenant = Date.now();
        const dateBannissement = banLog.createdTimestamp;
        const diffMs = maintenant - dateBannissement;
        
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHeures = Math.floor(diffMin / 60);
        const diffJours = Math.floor(diffHeures / 24);
        
        if (diffJours > 0) {
          temps = `${diffJours} jour${diffJours > 1 ? 's' : ''}`;
        } else if (diffHeures > 0) {
          temps = `${diffHeures} heure${diffHeures > 1 ? 's' : ''}`;
        } else if (diffMin > 0) {
          temps = `${diffMin} minute${diffMin > 1 ? 's' : ''}`;
        } else {
          temps = `${diffSec} seconde${diffSec > 1 ? 's' : ''}`;
        }
      }
      
      const embed = new EmbedBuilder()
        .setColor('#FFFFFF')
        .setTitle(`Informations de bannissement de ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setDescription(
          `**Banni** : ${user} | \`${user.id}\`\n` +
          `**Banni par** : ${banniPar} | \`${banniParId}\`\n` +
          `Il y'a ${temps}\n\n` +
          `\`\`\`Raison : ${reason}\`\`\``
        );
      
      message.channel.send({ embeds: [embed] });
    } catch (error) {
      // Essayer de récupérer l'utilisateur pour la mention
      try {
        const user = await client.users.fetch(userId);
        message.reply(`${user} n'est pas ban`);
      } catch {
        message.reply(`\`${userId}\` n'est pas ban`);
      }
    }
  }
  
  // Commande blinfo
  if (command === 'blinfo') {
    const userInput = args[0];
    if (!userInput) return message.reply('Veuillez specifier un utilisateur (ID ou mention)');
    
    let userId = userInput.replace(/[<@!>]/g, '');
    
    try {
      // Récupérer le serveur principal
      const serveurPrincipal = client.guilds.cache.get(SERVEUR_PRINCIPAL_ID);
      if (!serveurPrincipal) {
        return message.reply('Erreur');
      }
      
      // Chercher l'utilisateur
      const user = await client.users.fetch(userId);
      const reason = 'Aucune raison fournie';
      const temps = 'X';
      
      // Récupérer les logs d'audit
      const auditLogs = await serveurPrincipal.fetchAuditLogs({
        limit: 10
      });
      
      const blacklistLog = auditLogs.entries.find(entry => entry.target.id === userId);
      
      let blacklistPar = message.author;
      let blacklistParId = message.author.id;
      
      if (blacklistLog) {
        blacklistPar = blacklistLog.executor;
        blacklistParId = blacklistLog.executor.id;
      }
      
      const embed = new EmbedBuilder()
        .setColor('#FFFFFF')
        .setTitle(`Informations de blacklist de ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setDescription(
          `**Cible** : ${user} | \`${userId}\`\n` +
          `**Blacklist par** : ${blacklistPar} | \`${blacklistParId}\`\n` +
          `Il y'a ${temps} temps\n\n` +
          `\`\`\`Raison : ${reason}\`\`\``
        );
      
      message.channel.send({ embeds: [embed] });
    } catch (error) {
      // Essayer de récupérer l'utilisateur pour la mention
      try {
        const user = await client.users.fetch(userId);
        message.reply(`${user} n'est pas bl`);
      } catch {
        message.reply(`\`${userId}\` n'est pas bl`);
      }
    }
  }
  
  // Commande vc/voc
  if (command === 'vc' || command === 'voc') {
    const members = await message.guild.members.fetch();
    const totalMembers = members.size;
    const onlineMembers = members.filter(m => {
      const status = m.presence?.status;
      return status === 'online' || status === 'idle' || status === 'dnd';
    }).size;
    const voiceMembers = members.filter(m => m.voice.channelId).size;
    const streamingMembers = members.filter(m => {
      return m.voice.streaming === true;
    }).size;
    const mutedMembers = members.filter(m => {
      return m.voice.mute || m.voice.selfMute;
    }).size;
    
    const embed = new EmbedBuilder()
      .setColor('#FFFFFF')
      .setTitle('__Aku\'Stats__')
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
        return message.reply('Veuillez specifier un nombre entre 1 et 100.');
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
    
    const guildCommands = commandsConfig.get(message.guild.id) || DEFAULT_COMMANDS;
    
    const formatCommands = (level) => {
      const cmds = guildCommands[level] || [];
      return cmds.join(' ') || 'Aucune commande';
    };
    
    const embed = new EmbedBuilder()
      .setColor('#FFFFFF')
      .setDescription(
        `**Configuration actuelle**\n\n` +
        `**Perm1**\nRoles: ${guildPerms.perm1.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\nCommandes: \`\`\`${formatCommands('perm1')}\`\`\`\n` +
        `**Perm2**\nRoles: ${guildPerms.perm2.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\nCommandes: \`\`\`${formatCommands('perm2')}\`\`\`\n` +
        `**Perm3**\nRoles: ${guildPerms.perm3.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\nCommandes: \`\`\`${formatCommands('perm3')}\`\`\`\n` +
        `**Perm4**\nRoles: ${guildPerms.perm4.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\nCommandes: \`\`\`${formatCommands('perm4')}\`\`\`\n` +
        `**Owner**\nRoles: ${guildPerms.owner.map(id => id === message.guild.ownerId ? 'Proprietaire' : `<@&${id}>`).join(' ') || 'Proprietaire uniquement'}\nCommandes: \`\`\`${formatCommands('owner')}\`\`\``
      );
    
    message.channel.send({ embeds: [embed] });
  }
});

// Gestion des interactions pour la configuration
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  
  // Configuration des roles
  if (interaction.customId === 'config_roles') {
    if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== SUPER_ADMIN_ID) {
      return interaction.reply({
        content: 'Seul le proprietaire du serveur peut configurer les permissions.',
        ephemeral: true
      });
    }
    
    const permLevel = interaction.values[0].replace('roles_', '');
    
    const row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`roles_action_${permLevel}`)
          .setPlaceholder('Que voulez-vous faire ?')
          .addOptions([
            {
              label: 'Ajouter des roles',
              description: 'Donner acces a ce niveau',
              value: 'add',
            },
            {
              label: 'Enlever des roles',
              description: 'Retirer l acces a ce niveau',
              value: 'remove',
            }
          ])
      );
    
    await interaction.reply({
      content: `**${permLevel.toUpperCase()}** - Choisissez une action :`,
      components: [row],
      ephemeral: true
    });
  }
  
  // Gestion de l'action (ajouter/enlever roles)
  if (interaction.customId.startsWith('roles_action_')) {
    const permLevel = interaction.customId.replace('roles_action_', '');
    const action = interaction.values[0];
    
    const filter = m => m.author.id === interaction.user.id;
    
    if (action === 'add') {
      await interaction.update({
        content: `Mentionnez les roles a ajouter a **${permLevel.toUpperCase()}** (separez par des espaces) :`,
        components: []
      });
      
      const collected = await interaction.channel.awaitMessages({
        filter,
        max: 1,
        time: 60000,
        errors: ['time']
      }).catch(() => null);
      
      if (!collected) {
        return interaction.followUp({
          content: 'Temps ecoule. Configuration annulee.',
          ephemeral: true
        });
      }
      
      const response = collected.first();
      const roleMentions = response.mentions.roles;
      
      if (roleMentions.size === 0) {
        return interaction.followUp({
          content: 'Aucun role valide mentionne. Configuration annulee.',
          ephemeral: true
        });
      }
      
      // Sauvegarder la configuration (AJOUT)
      const guildPerms = permConfig.get(interaction.guild.id) || {
        perm1: [],
        perm2: [],
        perm3: [],
        perm4: [],
        owner: [interaction.guild.ownerId]
      };
      
      // Ajouter les nouveaux roles sans doublons
      const nouveauxRoles = roleMentions.map(r => r.id);
      guildPerms[permLevel] = [...new Set([...guildPerms[permLevel], ...nouveauxRoles])];
      permConfig.set(interaction.guild.id, guildPerms);
      
      await response.delete();
      
      interaction.followUp({
        content: `Roles ajoutes a **${permLevel.toUpperCase()}** : ${roleMentions.map(r => r.toString()).join(' ')}`,
        ephemeral: true
      });
      
    } else if (action === 'remove') {
      // Afficher la liste des roles actuels pour choisir lesquels enlever
      const guildPerms = permConfig.get(interaction.guild.id) || {
        perm1: [],
        perm2: [],
        perm3: [],
        perm4: [],
        owner: [interaction.guild.ownerId]
      };
      
      const rolesActuels = guildPerms[permLevel] || [];
      
      if (rolesActuels.length === 0) {
        return interaction.update({
          content: `Aucun role configure pour **${permLevel.toUpperCase()}**.`,
          components: [],
          ephemeral: true
        });
      }
      
      // Créer un menu avec les roles actuels
      const options = [];
      for (const roleId of rolesActuels) {
        const role = interaction.guild.roles.cache.get(roleId);
        if (role) {
          options.push({
            label: role.name,
            value: roleId,
            description: `ID: ${roleId}`
          });
        }
      }
      
      if (options.length === 0) {
        return interaction.update({
          content: `Aucun role valide trouve pour **${permLevel.toUpperCase()}**.`,
          components: [],
          ephemeral: true
        });
      }
      
      const row = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`roles_remove_${permLevel}`)
            .setPlaceholder('Choisir les roles a enlever')
            .setMinValues(1)
            .setMaxValues(options.length)
            .addOptions(options)
        );
      
      await interaction.update({
        content: `**${permLevel.toUpperCase()}** - Selectionnez les roles a enlever :`,
        components: [row],
        ephemeral: true
      });
    }
  }
  
  // Gestion de la suppression des roles
  if (interaction.customId.startsWith('roles_remove_')) {
    const permLevel = interaction.customId.replace('roles_remove_', '');
    const rolesToRemove = interaction.values;
    
    const guildPerms = permConfig.get(interaction.guild.id) || {
      perm1: [],
      perm2: [],
      perm3: [],
      perm4: [],
      owner: [interaction.guild.ownerId]
    };
    
    // Enlever les roles selectionnes
    guildPerms[permLevel] = guildPerms[permLevel].filter(id => !rolesToRemove.includes(id));
    permConfig.set(interaction.guild.id, guildPerms);
    
    const rolesRemoved = rolesToRemove.map(id => `<@&${id}>`).join(' ');
    
    await interaction.update({
      content: `Roles enleves de **${permLevel.toUpperCase()}** : ${rolesRemoved}`,
      components: [],
      ephemeral: true
    });
  }
  
  // Configuration des commandes
  if (interaction.customId === 'config_commands') {
    if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== SUPER_ADMIN_ID) {
      return interaction.reply({
        content: 'Seul le proprietaire du serveur peut configurer les permissions.',
        ephemeral: true
      });
    }
    
    const permLevel = interaction.values[0].replace('cmd_', '');
    
    // Récupérer les commandes actuelles pour ce niveau
    const guildCommands = commandsConfig.get(interaction.guild.id) || DEFAULT_COMMANDS;
    const currentCommands = guildCommands[permLevel] || [];
    
    // Créer un menu avec toutes les commandes disponibles
    const options = AVAILABLE_COMMANDS.map(cmd => ({
      label: cmd,
      value: cmd,
      description: currentCommands.includes(cmd) ? 'Deja assigne' : 'Non assigne',
      default: currentCommands.includes(cmd)
    }));
    
    const row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`commands_set_${permLevel}`)
          .setPlaceholder('Selectionnez les commandes pour ce niveau')
          .setMinValues(0)
          .setMaxValues(options.length)
          .addOptions(options)
      );
    
    await interaction.reply({
      content: `**${permLevel.toUpperCase()}** - Selectionnez les commandes pour ce niveau :`,
      components: [row],
      ephemeral: true
    });
  }
  
  // Gestion de l'assignation des commandes
  if (interaction.customId.startsWith('commands_set_')) {
    const permLevel = interaction.customId.replace('commands_set_', '');
    const selectedCommands = interaction.values;
    
    const guildCommands = commandsConfig.get(interaction.guild.id) || { ...DEFAULT_COMMANDS };
    guildCommands[permLevel] = selectedCommands;
    commandsConfig.set(interaction.guild.id, guildCommands);
    
    const commandsList = selectedCommands.join(', ') || 'Aucune commande';
    
    await interaction.update({
      content: `Commandes pour **${permLevel.toUpperCase()}** mises a jour : ${commandsList}`,
      components: [],
      ephemeral: true
    });
  }
  
  // Voir configuration
  if (interaction.customId === 'config_view') {
    if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== SUPER_ADMIN_ID) {
      return interaction.reply({
        content: 'Seul le proprietaire du serveur peut configurer les permissions.',
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
      
      const guildCommands = commandsConfig.get(interaction.guild.id) || DEFAULT_COMMANDS;
      
      const formatCommands = (level) => {
        const cmds = guildCommands[level] || [];
        return cmds.join(', ') || 'Aucune commande';
      };
      
      const embed = new EmbedBuilder()
        .setColor('#FFFFFF')
        .setTitle('Configuration actuelle')
        .setDescription(
          `**Perm1**\nRoles: ${guildPerms.perm1.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\nCommandes: ${formatCommands('perm1')}\n\n` +
          `**Perm2**\nRoles: ${guildPerms.perm2.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\nCommandes: ${formatCommands('perm2')}\n\n` +
          `**Perm3**\nRoles: ${guildPerms.perm3.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\nCommandes: ${formatCommands('perm3')}\n\n` +
          `**Perm4**\nRoles: ${guildPerms.perm4.map(id => `<@&${id}>`).join(' ') || 'Aucun'}\nCommandes: ${formatCommands('perm4')}\n\n` +
          `**Owner**\nRoles: ${guildPerms.owner.map(id => id === interaction.guild.ownerId ? 'Proprietaire' : `<@&${id}>`).join(' ') || 'Proprietaire uniquement'}\nCommandes: ${formatCommands('owner')}`
        );
      
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    if (action === 'reset') {
      permConfig.delete(interaction.guild.id);
      commandsConfig.delete(interaction.guild.id);
      return interaction.reply({
        content: 'Configuration reinitialisee. Toutes les permissions sont maintenant reservees au proprietaire.',
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