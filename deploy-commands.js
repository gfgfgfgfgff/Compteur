const { REST, Routes } = require('discord.js');

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

(async () => {
  try {
    console.log('Déploiement des commandes slash...');
    
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    
    console.log('Commandes déployées avec succès !');
  } catch (error) {
    console.error(error);
  }
})();