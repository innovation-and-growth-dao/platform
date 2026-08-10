import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class NonceRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  stakeAddress!: string;
}

export class VerifyRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  stakeAddress!: string;

  /** COSE_Sign1 cbor hex from CIP-30 signData. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  signature!: string;

  /** COSE_Key cbor hex from CIP-30 signData. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  key!: string;

  /** CIP-95 DRep public key hex (if the wallet exposes one) — used to recognize
   * board membership / DRep status by on-chain DRep key. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  drepKeyHex?: string;
}
