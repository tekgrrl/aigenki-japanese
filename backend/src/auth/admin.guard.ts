import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION } from '../firebase/firebase.module';
import { FirebaseAuthGuard } from './firebase-auth.guard';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly authGuard: FirebaseAuthGuard,
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.authGuard.canActivate(context);

    const { user } = context.switchToHttp().getRequest();
    const uid: string = user?.uid;

    if (process.env.ADMIN_ALL === 'true') return true;

    const doc = await this.db.collection('users').doc(uid).get();
    if (doc.exists && doc.data()?.isAdmin === true) return true;

    throw new ForbiddenException('Admin access required');
  }
}
