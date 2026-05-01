import { Module, Global } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getFirestore } from 'firebase-admin/firestore';
// Custom Token for Injection
export const FIRESTORE_CONNECTION = 'FIRESTORE_CONNECTION';
export const KNOWLEDGE_UNITS_COLLECTION = "knowledge-units";
export const REVIEW_FACETS_COLLECTION = "review-facets";
export const LESSONS_COLLECTION = "lessons";
export const API_LOGS_COLLECTION = "api-logs";
export const QUESTIONS_COLLECTION = "questions";
export const USER_STATS_COLLECTION = 'user-stats';
export const SCENARIOS_COLLECTION = 'scenarios';
export const CONCEPTS_COLLECTION = 'concepts';
export const USER_KUS_SUBCOLLECTION = 'user-kus';
export const USER_CONCEPTS_SUBCOLLECTION = 'user-concepts';
export const QUESTION_STATES_SUBCOLLECTION = 'question-states';
export const USER_GRAMMAR_LESSONS_SUBCOLLECTION = 'user-grammar-lessons';
export const USER_LESSONS_SUBCOLLECTION = 'user-lessons';
export const Timestamp = admin.firestore.Timestamp;
export const FieldValue = admin.firestore.FieldValue;

@Global() // Makes this module available everywhere without importing it
@Module({
  imports: [ConfigModule.forRoot()],
  providers: [
    {
      provide: FIRESTORE_CONNECTION,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Prevent double initialization in hot-reload
        if (!admin.apps.length) {
          admin.initializeApp({
            projectId: configService.get<string>('GOOGLE_CLOUD_PROJECT'), // Matches your emulator/project config
          });
        }
        const firestoreDbName = configService.get<string>('FIRESTORE_DB') || '(default)';
        const db = getFirestore(admin.app(), firestoreDbName);
        db.settings({ ignoreUndefinedProperties: true });
        return db;
      },
    },
  ],
  exports: [FIRESTORE_CONNECTION], // Export the provider so other modules can use it
})
export class FirebaseModule { }