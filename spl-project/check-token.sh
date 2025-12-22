#!/bin/bash

TOKEN_MINT="52RXuXrTNBDwvvsoQT4hrA6Xg5CHaLbirAmPuxxGNUtk"
NETWORK="https://api.devnet.solana.com"

echo "🔍 Checking Token Info..."
echo "================================"

echo -e "\n📊 Token Display:"
spl-token display $TOKEN_MINT --url $NETWORK

echo -e "\n💰 Total Supply:"
spl-token supply $TOKEN_MINT --url $NETWORK

echo -e "\n📦 Your Token Accounts:"
spl-token accounts $TOKEN_MINT --url $NETWORK

echo -e "\n✅ Done!"