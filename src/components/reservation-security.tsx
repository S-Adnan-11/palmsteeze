'use client';
import type {Ref} from 'react';
import {SecurityChallenge,type SecurityChallengeHandle} from './security-challenge';
export function ReservationSecurity(props:{ref:Ref<SecurityChallengeHandle>;disabled:boolean}) {
  return <SecurityChallenge action="reserve" {...props}/>;
}
