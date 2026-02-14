const { Client, GatewayIntentBits, ChannelType, PermissionsBitField, REST, Routes } = require('discord.js');
const cron = require('node-cron');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Stockage des configurations de compteurs
const guildCounters = new Map();

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
            description: 'Nom du premier compteur (emojis acceptés)',
            type: 3,
            required: false
          },
          {
            name: 'compteur2',
            description: 'Nom du deuxième compteur (emojis acceptés)',
            type: 3,
            required: false
          },
          {
            name: 'compteur3',
            description: 'Nom du troisième compteur (emojis acceptés)',
            type: 3,
            required: false
          },
          {
            name: 'compteur4',
            description: 'Nom du quatrième compteur (emojis acceptés)',
            type: 3,
            required: false
          }
        ]
      }
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    
    console.log('🔄 Déploiement des commandes slash...');
    
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    
    console.log('✅ Commandes déployées avec succès !');
    console.log('📝 Commande disponible : /setup');
  } catch (error) {
    console.error('❌ Erreur lors du déploiement des commandes:', error);
  }
}

client.once('ready', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  console.log(`📊 Serveurs: ${client.guilds.cache.size}`);
  
  // Déployer les commandes au démarrage
  if (process.env.CLIENT_ID) {
    await deployCommands();
  } else {
    console.warn('⚠️ CLIENT_ID non défini, ajoutez-le dans Railway pour déployer les commandes');
  }
  
  // Planifier la mise à jour toutes les 5 minutes
  cron.schedule('*/5 * * * *', () => {
    console.log('🔄 Mise à jour automatique des compteurs...');
    updateAllCounters();
  });
  
  // Première mise à jour après 10 secondes
  setTimeout(() => {
    console.log('🔄 Première mise à jour des compteurs...');
    updateAllCounters();
  }, 10000);
});

async function updateAllCounters() {
  for (const [guildId, config] of guildCounters) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    
    try {
      await updateGuildCounters(guild, config);
    } catch (error) {
      console.error(`Erreur pour ${guild.name}:`, error);
    }
  }
}

async function updateGuildCounters(guild, config) {
  try {
    // Récupérer les membres
    const members = await guild.members.fetch();
    const totalMembers = members.size;
    
    // Membres en ligne (online, idle, dnd)
    const onlineMembers = members.filter(m => 
      m.presence?.status === 'online' || 
      m.presence?.status === 'idle' || 
      m.presence?.status === 'dnd'
    ).size;
    
    // Membres en vocal
    const voiceMembers = members.filter(m => m.voice.channelId).size;
    
    // Nombre de boosts
    const boostCount = guild.premiumSubscriptionCount || 0;
    
    const counters = [
      { name: config.counter1, value: `👥 ${totalMembers}` },
      { name: config.counter2, value: `🟢 ${onlineMembers}` },
      { name: config.counter3, value: `🔊 ${voiceMembers}` },
      { name: config.counter4, value: `🚀 ${boostCount}` }
    ];
    
    for (let i = 0; i < config.voiceChannels.length; i++) {
      const channelId = config.voiceChannels[i];
      const channel = guild.channels.cache.get(channelId);
      
      if (channel && counters[i]?.name) {
        const counterName = counters[i].name;
        const counterValue = counters[i].value;
        const newName = `${counterName} ${counterValue}`;
        
        if (channel.name !== newName) {
          await channel.setName(newName)
            .catch(console.error);
        }
      }
    }
  } catch (error) {
    console.error(`Erreur dans updateGuildCounters pour ${guild.name}:`, error);
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  
  const { commandName, options, user, guild } = interaction;
  
  if (commandName === 'setup') {
    // Vérifier si l'utilisateur est le propriétaire du serveur
    if (user.id !== guild.ownerId) {
      return interaction.reply({
        content: '❌ Seul le propriétaire du serveur peut utiliser cette commande !',
        ephemeral: true
      });
    }
    
    const category = options.getChannel('categorie');
    const counter1 = options.getString('compteur1');
    const counter2 = options.getString('compteur2');
    const counter3 = options.getString('compteur3');
    const counter4 = options.getString('compteur4');
    
    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.reply({
        content: '❌ Veuillez spécifier une catégorie valide !',
        ephemeral: true
      });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      // Supprimer les anciens salons vocaux
      const existingConfig = guildCounters.get(guild.id);
      if (existingConfig) {
        for (const channelId of existingConfig.voiceChannels) {
          const channel = guild.channels.cache.get(channelId);
          if (channel) await channel.delete().catch(console.error);
        }
      }
      
      // Créer les nouveaux salons vocaux
      const voiceChannels = [];
      const counters = [counter1, counter2, counter3, counter4].filter(c => c);
      
      for (let i = 0; i < counters.length; i++) {
        const counter = counters[i];
        
        const channel = await guild.channels.create({
          name: `${counter} ⏳`,
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
      
      // Créer le message de confirmation
      let confirmMessage = `✅ ${voiceChannels.length} compteurs vocaux créés avec succès !\n\n📊 **Configuration :**\n`;
      
      if (counter1) confirmMessage += `• ${counter1} → Membres totaux 👥\n`;
      if (counter2) confirmMessage += `• ${counter2} → Membres en ligne 🟢\n`;
      if (counter3) confirmMessage += `• ${counter3} → Membres en vocal 🔊\n`;
      if (counter4) confirmMessage += `• ${counter4} → Nombre de boosts 🚀\n`;
      
      confirmMessage += `\n⏱️ Mise à jour automatique toutes les 5 minutes.`;
      
      await interaction.editReply({
        content: confirmMessage
      });
      
      // Mise à jour immédiate
      await updateGuildCounters(guild, guildCounters.get(guild.id));
      
    } catch (error) {
      console.error(error);
      await interaction.editReply({
        content: '❌ Une erreur est survenue lors de la création des salons.'
      });
    }
  }
});

// Écouter les événements pour mettre à jour plus rapidement
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (oldState.channelId !== newState.channelId) {
    setTimeout(() => {
      updateAllCounters();
    }, 3000);
  }
});

client.on('guildMemberUpdate', async () => {
  setTimeout(() => {
    updateAllCounters();
  }, 3000);
});

client.on('guildUpdate', async () => {
  setTimeout(() => {
    updateAllCounters();
  }, 3000);
});

// Gestion des erreurs
client.on('error', console.error);
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

// Connexion avec le token Railway
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error('❌ Token Discord manquant ! Vérifiez les variables Railway.');
  console.error('💡 Ajoutez TOKEN dans les variables d\'environnement Railway');
  process.exit(1);
}

console.log('🚀 Démarrage du bot...');
client.login(TOKEN);