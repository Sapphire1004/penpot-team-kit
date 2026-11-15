# 운영·업데이트

## 중앙 서버 주소

기본 바인딩은 `127.0.0.1`이다. 사내 LAN에서 제공하려면 `.env`의 `PENPOT_BIND_ADDRESS=0.0.0.0`, `PENPOT_PUBLIC_URI=http://서버의-LAN-IP:9001`로 설정하고 `./penpot up`을 다시 실행한다. 방화벽에서 필요한 사용자 네트워크에만 9001을 허용한다. 동료는 같은 주소에 자기 계정으로 접속한다. 개인 PC의 전원이 꺼지면 모두 접속할 수 없다.

외부 직원이 써야 한다면 Azure 등 항상 켜진 서버 한 대 또는 회사 VPN 접근 가능한 서버를 사용한다. HTTPS 역방향 프록시를 두고 `PENPOT_PUBLIC_URI`를 최종 HTTPS 주소로 지정한다. 기존 `.env`에서는 `PENPOT_FLAGS`의 `disable-secure-session-cookies`를 `enable-secure-session-cookies`로 교체한다. 프록시는 `/ws/notifications` 및 `/mcp/` 경로의 WebSocket·HTTP 스트리밍과 업로드를 전달해야 한다. 이 키트에는 클라우드 생성·DNS·TLS 자동화가 포함되지 않는다.

DB·Valkey·관리 포트는 호스트에 공개하지 않는다. 관리 TCP는 backend 내부 loopback에만 열려 있고 도구 컨테이너가 backend 네트워크 공간에서 사용한다. Docker 실행 권한은 계정 생성 등 관리자 권한으로 취급한다.

## 계정과 언어

`./penpot account:create`로 계정을 만든 뒤 같은 팀에 추가한다. 비밀번호 해시·필수 프로필 정보를 공식 관리 명령이 생성하므로 SQL 직접 삽입보다 버전 변경에 덜 의존한다. 메일 기반 가입과 비밀번호 재설정은 꺼져 있다. 비밀번호 복구 정책은 배포 전 별도로 정한다.

언어는 계정 설정에서 사용자별로 바꿀 수 있다. 한국어·일본어 등 지원 언어가 있으며 Penpot의 커뮤니티 번역 범위를 따른다. 계정 언어는 디자인 안에 작성한 텍스트를 자동 번역하지 않는다.

## 저장과 백업

`database` 볼륨에 계정·권한·디자인 문서, `assets` 볼륨에 업로드 이미지·폰트 등 파일이 저장된다. 실제 볼륨 이름에는 `.env`의 Compose 프로젝트 이름이 붙는다. `.env`의 비밀값도 함께 보관한다. 운영 중 프로젝트 이름을 바꾸면 기존 볼륨과 다른 저장소가 선택될 수 있다.

다음은 쓰기 서비스를 멈춘 상태의 수동 백업 예시다. 기존 백업 파일이 있으면 다른 디렉터리를 사용한다. 복사본에는 개인 데이터·비밀값이 있으므로 공개 저장소에 올리지 않는다.

```sh
mkdir -m 700 backups
./penpot compose stop frontend backend mcp exporter
./penpot compose exec -T postgres pg_dump -U penpot -d penpot -Fc > backups/database.dump
./penpot compose run --rm --no-deps -T --user 0 --entrypoint tar frontend -C /opt/data/assets -czf - . > backups/assets.tar.gz
cp .env backups/environment.env
chmod 600 backups/*
./penpot up
```

명령 실패 시 백업 성공으로 간주하지 말고 원인을 확인한 뒤 서비스를 다시 올린다. 별도 테스트 환경에서 DB 복원과 에셋 복원을 함께 검증한다. 사용자 볼륨을 대상으로 `docker compose down -v`나 Docker prune을 실행하지 않는다.

## 가벼운 실행

이 구성은 테스트 메일함·별도 데모 앱·관리 콘솔을 제외한다. 기본 6개 서비스는 Penpot·인증·협업·내보내기·MCP를 위한 구성이다. SQLite로 전환하려면 Penpot 백엔드의 DB 구현을 포팅해야 하며 이 키트는 해당 작업을 하지 않는다. 컨테이너 개수와 서버 대수는 다르다. 한 VM에서 6개 서비스를 실행할 수 있다.

검증 때는 기존 개인 환경과 분리된 볼륨을 사용했고 최소 RAM·10브라우저 지속 부하는 측정하지 않았다. 실제 파일·폰트·내보내기 부하를 포함해 `docker stats`와 서버 메트릭으로 측정한 뒤 자원을 정한다.

## 공식 업데이트와 자체 개조

기본은 공식 이미지 사용이라 `.env`의 `PENPOT_VERSION`을 함께 변경해 frontend/backend/exporter/mcp 버전을 맞춘다. 공식 릴리스 노트를 확인하고 DB·에셋·설정을 백업한 뒤 복제 환경에서 마이그레이션과 협업·MCP를 검증한다.

```sh
./penpot compose pull
./penpot up
./penpot test
```

스키마가 바뀌었다면 이전 이미지로만 되돌리는 것을 복구로 간주하지 않는다. 이전 DB·에셋·설정 백업까지 맞춰 복구한다.

소스를 수정할 때는 공식 저장소를 fork하고 기준 태그와 변경 커밋을 관리한다. 새로운 공식 태그를 upstream에서 가져와 별도 브랜치에 병합하고, 충돌을 해결한 뒤 자체 이미지를 빌드해 Compose override로 지정한다. 공식 이미지 내부 파일을 직접 바꾸는 방식은 재생성 때 사라진다. 먼저 설정·운영 스크립트로 해결하고 소스 변경은 필요한 부분으로 좁히면 업데이트 충돌을 줄일 수 있다.
