import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { JwtGuard } from "./auth/jwt.guard";
import configuration, { AppConfig, validateEnv } from "./config/configuration";
import { HealthController } from "./health/health.controller";
import { AddressService } from "./mail/address.service";
import { MailController } from "./mail/mail.controller";
import { MailService } from "./mail/mail.service";
import { MailboxInterceptor } from "./mail/mailbox.interceptor";
import { MailboxService } from "./mail/mailbox.service";
import { RateLimitService } from "./mail/rate-limit.service";
import { SearchService } from "./mail/search.service";
import { MailItem, MailItemSchema, Mailbox, MailboxSchema, RateLimit, RateLimitSchema, UserRef, UserRefSchema } from "./schemas/schemas";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<AppConfig>("app")!.mongoUri,
        serverSelectionTimeoutMS: 15_000,
      }),
    }),
    MongooseModule.forFeature([
      { name: MailItem.name, schema: MailItemSchema },
      { name: Mailbox.name, schema: MailboxSchema },
      { name: RateLimit.name, schema: RateLimitSchema },
      { name: UserRef.name, schema: UserRefSchema },
    ]),
  ],
  controllers: [HealthController, MailController],
  providers: [JwtGuard, MailboxInterceptor, AddressService, MailService, MailboxService, SearchService, RateLimitService],
})
export class AppModule {}
