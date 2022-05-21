import { StatusEmbed, StatusEmoji } from "#root/classes/EvieEmbed";
import { Schedule } from "#root/classes/Schedule";
import { container } from "@sapphire/framework";
import { captureException } from "@sentry/node";
import { Constants, DiscordAPIError } from "discord.js";

export class TempBans extends Schedule {
  override async execute() {
    const { client } = container;
    const tempbans = await client.prisma.modAction.findMany({
      where: {
        type: "Ban",
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    for (const tempban of tempbans) {
      if (!tempban.guildId) return;
      try {
        const guild = await client.guilds.fetch(tempban.guildId);
        const user = (await guild.bans.fetch(tempban.id))?.user;

        if (!user) return;

        await guild.members
          .unban(user)
          .catch(() =>
            client.guildLogger.sendEmbedToLogChannel(
              guild,
              new StatusEmbed(StatusEmoji.FAIL, `Failed to unban ${user.tag}`)
            )
          );

        return void client.punishments.createModAction(guild, {
          action: "Unban",
          target: user,
          reason: `Temp-ban expired`, // TODO: Track mod action messages and reference the message link
        });
      } catch (error) {
        if (!(error instanceof DiscordAPIError))
          return void captureException(error);
        if (error.code == Constants.APIErrors.UNKNOWN_BAN) {
          return;
        }
      }
    }
    return;
  }
}
