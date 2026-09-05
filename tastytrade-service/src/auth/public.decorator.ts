import { SetMetadata } from '@nestjs/common';

/** Marks a route (or whole controller) as exempt from the global API-key guard. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
