import { EvieEmbed, ReplyStatusEmbed } from "#root/classes/EvieEmbed";
import { ImportMessageModal } from "#root/constants/modals";
import { miscDB } from "#root/utils/database/misc";
import { informNeedsPerms, PermissionLang } from "#root/utils/misc/perms";
import { registeredGuilds } from "@evie/config";
import { ApplyOptions } from "@sapphire/decorators";
import {
  ApplicationCommandRegistry,
  Command,
  RegisterBehavior,
} from "@sapphire/framework";
import * as Sentry from "@sentry/node";
import { ApplicationCommandType } from "discord-api-types/v9";
import {
  ButtonInteraction,
  CommandInteraction,
  ContextMenuInteraction,
  Message,
  MessageActionRow,
  MessageButton,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  Permissions,
  Snowflake,
  SnowflakeUtil,
  TextChannel,
} from "discord.js";
@ApplyOptions<Command.Options>({
  description: "Sends Discord Message JSON as a message",
})
export class ImportMessage extends Command {
  public override async chatInputRun(
    interaction: CommandInteraction
  ): Promise<void> {
    if (!interaction.inCachedGuild()) return;

    const perms: Permissions = interaction.member?.permissions as Permissions;
    const channel = interaction.options.getChannel("channel");

    if (!(channel instanceof TextChannel)) {
      await ReplyStatusEmbed(
        false,
        "Please provide a valid text channel.",
        interaction
      );
      return;
    }

    if (!perms.has(Permissions.FLAGS.MANAGE_MESSAGES)) {
      return informNeedsPerms(interaction, PermissionLang.MANAGE_MESSAGES);
    }

    if (
      !channel
        .permissionsFor(interaction.member)
        .has(Permissions.FLAGS.SEND_MESSAGES)
    ) {
      await ReplyStatusEmbed(
        false,
        "You do not have permission to send messages in this channel.",
        interaction
      );
      return;
    }

    if (
      !interaction.guild.me
        ?.permissionsIn(channel)
        .has(Permissions.FLAGS.SEND_MESSAGES)
    ) {
      await ReplyStatusEmbed(
        false,
        "I do not have permission to send messages in this channel.",
        interaction
      );
      return;
    }

    const generatedState = SnowflakeUtil.generate();

    await interaction.showModal(ImportMessageModal(generatedState));
    this.waitForModal(interaction, channel, generatedState);
  }

  public override async contextMenuRun(interaction: ContextMenuInteraction) {
    if (!interaction.inCachedGuild()) return;

    const message = interaction.options.getMessage("message", true);

    if (!message) {
      await ReplyStatusEmbed(
        false,
        `Please provide a valid message.`,
        interaction
      );
      return;
    }

    if (message.author.id !== interaction.client.user?.id) {
      await ReplyStatusEmbed(
        false,
        `Please Provide a message that was sent by me.
        This context menu is used to edit messages you made me send.
        For more information, read the [documentation on this feature](https://docs.eviebot.rocks/commands/import-message.html).`,
        interaction
      );
      return;
    }

    if (
      !(await miscDB.getImportedMessages(interaction.guild)).includes(
        message.id
      )
    ) {
      await ReplyStatusEmbed(
        false,
        `Please don't try and edit a message that is not user-generated.`,
        interaction
      );
      return;
    }

    const perms: Permissions = interaction.member?.permissions as Permissions;

    if (!perms.has(Permissions.FLAGS.MANAGE_MESSAGES)) {
      informNeedsPerms(interaction, PermissionLang.MANAGE_MESSAGES);
      return;
    }

    if (
      !message.channel
        .permissionsFor(interaction.member)
        .has(Permissions.FLAGS.SEND_MESSAGES)
    ) {
      await ReplyStatusEmbed(
        false,
        "You do not have permission to send messages in this channel.",
        interaction
      );
      return;
    }

    if (
      !interaction.guild.me
        ?.permissionsIn(message.channel)
        .has(Permissions.FLAGS.SEND_MESSAGES)
    ) {
      await ReplyStatusEmbed(
        false,
        "I do not have permission to edit messages in this channel.",
        interaction
      );
      return;
    }

    const generatedState = SnowflakeUtil.generate();

    await interaction.reply({
      embeds: [
        new EvieEmbed().setDescription(
          `Tip: You can copy and paste the existing message JSON into the "JSON Data Editor" on [Discohook](https://discohook.org/) to easily edit the message.
          Press continue to continue.`
        ),
      ],
      components: [
        new MessageActionRow().addComponents(
          new MessageButton()
            .setLabel("Continue")
            .setStyle("PRIMARY")
            .setCustomId(`countinue_msg_import_${generatedState}`)
        ),
      ],
      ephemeral: true,
    });

    await this.waitForButton(interaction, generatedState, message);
  }

  private async waitForButton(
    interaction: ContextMenuInteraction,
    stateflake: Snowflake,
    existingMessage?: Message
  ) {
    if (!interaction.channel) return;
    if (!existingMessage) return;

    const filter = (i: MessageComponentInteraction) =>
      i.customId === `countinue_msg_import_${stateflake}` &&
      i.type === "MESSAGE_COMPONENT";

    const collector = interaction.channel.createMessageComponentCollector({
      filter,
      time: 300000,
    });
    collector.on("collect", async (i: ButtonInteraction) => {
      const generatedState = SnowflakeUtil.generate();

      await i.showModal(
        ImportMessageModal(
          generatedState,
          JSON.stringify(
            {
              content: existingMessage.content || null,
              embeds: existingMessage.embeds || null,
            },
            null,
            2
          )
        )
      );

      this.waitForModal(
        i,
        existingMessage.channel as TextChannel,
        generatedState,
        existingMessage
      );
    });
    collector.on("end", async () => {
      ReplyStatusEmbed(false, `Import Timed Out`, interaction);
    });
  }

  private async waitForModal(
    interaction: CommandInteraction | ButtonInteraction,
    channel: TextChannel,
    stateflake: Snowflake,
    existingMessage?: Message
  ) {
    const submit = (await interaction
      .awaitModalSubmit({
        filter: (i) => i.customId === `import_msgjson_${stateflake}`,
        time: 100000,
      })
      .catch(() => {
        ReplyStatusEmbed(false, `Import Timed Out`, interaction);
      })) as ModalSubmitInteraction;

    if (!submit) return;
    if (!submit.fields) return;

    const jsonData = submit.fields.getTextInputValue("json_data");

    if (jsonData) {
      try {
        if (existingMessage) {
          const json = JSON.parse(jsonData);

          const message = await existingMessage.edit(json);

          await miscDB.addImportedMessage(message);

          return ReplyStatusEmbed(
            true,
            `Imported [here](<${message.url}>)!`,
            submit
          );
        } else {
          const json = JSON.parse(jsonData);

          const message = await channel.send(json);
          await miscDB.addImportedMessage(message);

          return ReplyStatusEmbed(
            true,
            `Imported [here](<${message.url}>)!`,
            submit
          );
        }
      } catch (e) {
        Sentry.captureException(e);
        await ReplyStatusEmbed(
          false,
          `Failed to import. For more information, read the [documentation on this feature](https://docs.eviebot.rocks/commands/import-message.html).`,
          submit
        );
      }
    } else {
      await ReplyStatusEmbed(
        false,
        `Missing JSON Data. For more information, read the [documentation on this feature](https://docs.eviebot.rocks/commands/import-message.html).`,
        submit
      );
    }
  }

  public override registerApplicationCommands(
    registry: ApplicationCommandRegistry
  ) {
    registry.registerContextMenuCommand(
      (builder) =>
        builder //
          .setName("Edit Message")
          .setType(ApplicationCommandType.Message),
      {
        guildIds: registeredGuilds,
        behaviorWhenNotIdentical: RegisterBehavior.Overwrite,
        idHints: ["954547076920930354"],
      }
    );

    registry.registerChatInputCommand(
      {
        name: this.name,
        description: this.description,
        options: [
          {
            name: "channel",
            description: "Channel to send the message to",
            type: "CHANNEL",
            required: true,
          },
        ],
      },
      {
        guildIds: registeredGuilds,
        behaviorWhenNotIdentical: RegisterBehavior.Overwrite,
        idHints: ["954547077650735114"],
      }
    );
  }
}
