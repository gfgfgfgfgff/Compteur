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
    
    // Nombre de boosts
    const boostCount = guild.premiumSubscriptionCount || 0;
    
    console.log(`Donnees pour ${guild.name}:`);
    console.log(`   - Total: ${totalMembers}`);
    console.log(`   - En ligne: ${onlineMembers}`);
    console.log(`   - En vocal: ${voiceMembers}`);
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

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  
  const { commandName, options, user, guild } = interaction;
  
  if (commandName === 'setup') {
    console.log(`Commande setup recue de ${user.tag} sur ${guild?.name}`);
    
    // Vérifier si l'utilisateur est le propriétaire du serveur
    if (user.id !== guild.ownerId) {
      console.log(`${user.tag} n'est pas proprietaire`);
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
          name: `${counter} ...`,  // Temporary name with dots
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
      
      // Message de confirmation SANS EMOJIS
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