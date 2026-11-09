import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { UserService } from '../users/user.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly authGuard: FirebaseAuthGuard,
    private readonly userService: UserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.authGuard.canActivate(context);
    const { user } = context.switchToHttp().getRequest();
    if (await this.userService.isAdmin(user?.uid)) return true;
    throw new ForbiddenException('Admin access required');
  }
}
