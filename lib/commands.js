// Discord option types: 1 = SUB_COMMAND, 3 = STRING, 7 = CHANNEL
const MANAGE_GUILD = String(1 << 5);
const GUILD_ONLY = { contexts: [0], integration_types: [0] };

export const COMMANDS = [
  {
    name: 'status',
    description: 'Check whether the tracked Minecraft servers are online',
    ...GUILD_ONLY,
    options: [
      {
        type: 3,
        name: 'name',
        description: 'Server name (leave empty to check all)',
        required: false,
        autocomplete: true,
      },
    ],
  },
  {
    name: 'server',
    description: 'Manage the tracked Minecraft servers',
    default_member_permissions: MANAGE_GUILD, // only "Manage Server" by default
    ...GUILD_ONLY,
    options: [
      {
        type: 1,
        name: 'add',
        description: 'Track a new server',
        options: [
          {
            type: 3,
            name: 'name',
            description: 'Short name you will use, e.g. survival (a-z, 0-9, _ -)',
            required: true,
            max_length: 32,
          },
          {
            type: 3,
            name: 'address',
            description: 'host or host:port, e.g. myserver.aternos.me',
            required: true,
            max_length: 255,
          },
          {
            type: 3,
            name: 'edition',
            description: 'Java (default) or Bedrock',
            required: false,
            choices: [
              { name: 'Java', value: 'java' },
              { name: 'Bedrock', value: 'bedrock' },
            ],
          },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Stop tracking a server',
        options: [
          {
            type: 3,
            name: 'name',
            description: 'Server name',
            required: true,
            autocomplete: true,
          },
        ],
      },
      {
        type: 1,
        name: 'list',
        description: 'List tracked servers without pinging them',
      },
      {
        type: 1,
        name: 'alerts',
        description: 'Choose where to post when a server comes online or goes offline',
        options: [
          {
            type: 7,
            name: 'channel',
            description: 'Channel for alerts (leave empty to turn alerts off)',
            required: false,
            channel_types: [0, 5], // text, announcement
          },
        ],
      },
    ],
  },
];
