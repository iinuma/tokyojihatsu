#!/bin/sh
# デフォルト経路のインターフェースから LAN IP を取る。
# Wi-Fi が en0 とは限らない（Thunderbolt ブリッジ等があると en1 以降になる）ので、
# インターフェース名を決め打ちにしない。
set -e

iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
if [ -n "$iface" ]; then
  ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
  if [ -n "$ip" ]; then
    echo "$ip"
    exit 0
  fi
fi

# 予備: 169.254.x（self-assigned）を除いた最初の IPv4
ifconfig 2>/dev/null \
  | awk '/inet /{print $2}' \
  | grep -v '^127\.' \
  | grep -v '^169\.254\.' \
  | head -1
