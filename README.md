# Penpot Team Kit

로그인과 팀별 권한을 유지하면서 작은 팀이 같은 Penpot 서버를 쓰기 위한 비공식 Docker 실행 구성입니다. **공식 Penpot 2.18.5 이미지와 내장 MCP**를 사용합니다. 테스트 메일함, 별도 React 데모, 로그인 우회는 포함하지 않습니다.

## 시작하기

Docker Engine + Compose 또는 Docker Desktop, Git이 필요합니다. Node.js를 호스트에 설치할 필요는 없습니다. `./penpot` 명령은 macOS/Linux의 POSIX 셸에서 실행합니다. Windows는 WSL에서 사용하세요.

```sh
git clone https://github.com/Sapphire1004/penpot-team-kit.git
cd penpot-team-kit
./penpot up
./penpot account:create
```

마지막 명령에서 이메일·이름·비밀번호를 입력합니다. [http://localhost:9001](http://localhost:9001)에서 로그인하세요. 공개 가입은 꺼져 있고 운영자가 같은 명령으로 사용자마다 계정을 만듭니다. 비밀번호는 SQL에 평문으로 넣지 않습니다. 메일 전송·메일 인증·메일 기반 재설정은 사용하지 않습니다.

처음 실행하면 비밀값을 생성해 비공개 `.env`에 저장합니다. `.env.example`은 항목 설명용이며 그대로 복사하지 않습니다. 이미 존재하는 `.env`는 덮어쓰지 않습니다. 기본 9001 포트가 사용 중이면 최초 실행 전 다음처럼 바꿀 수 있습니다.

```sh
PENPOT_PORT=9101 PENPOT_PUBLIC_URI=http://localhost:9101 ./penpot init
./penpot up
```

## 팀이 함께 쓰기

한 사람이 운영하는 서버 하나에 모두 접속합니다. 각자 이 저장소를 실행하면 각자 다른 DB가 생깁니다. 같은 팀을 만들고 등록된 계정을 초대해 프로젝트·파일을 공유하세요. 편집 링크도 로그인과 팀 권한이 적용됩니다. 가입된 계정은 메일 인증 비활성 설정에서 팀 초대로 직접 추가됩니다.

기본 주소는 해당 컴퓨터에서만 열립니다. 사내 LAN 접속은 [운영 안내](docs/OPERATIONS.md)의 주소 설정을 적용하세요. 외부 직원에게 제공하려면 접근 가능한 중앙 서버와 HTTPS 또는 회사 VPN을 준비해야 합니다. 이 저장소가 클라우드 서버를 자동으로 생성하지는 않습니다.

## MCP

디자인 파일을 열고 File → MCP Server → Connect를 실행한 뒤 개인 연결 URL을 MCP 클라이언트에 설정합니다. 메뉴 이름은 계정 언어에 따라 다릅니다. 내장 MCP가 포함되므로 별도의 개발용 localhost:4400 플러그인 설치는 필요하지 않습니다.

각 사용자는 자기 계정·키로 연결합니다. 한 계정의 키에 연결된 현재 디자인 파일을 대상으로 작동하므로 프로젝트가 바뀌면 대상 파일 ID를 먼저 확인하세요. 다른 사람의 키를 함께 쓰지 않습니다. [Claude Code 설정 예시와 연결 제약](docs/MCP.md)을 참고하세요. 특정 디자인 스킬은 필요하지 않습니다.

## 실제 검증

새 DB와 에셋 볼륨으로 이 구성을 실행한 뒤 **서로 다른 계정 10개, 협업 WebSocket 10개**를 연결했습니다. 편집자 8명·뷰어 2명, 5회에 걸친 수정 40회와 권한 차단 등 11개 검사가 통과했습니다. 임시 계정 11개는 테스트 후 삭제 요청하고 로그인 거부를 확인했습니다.

이는 짧은 프로토콜 통합 시험입니다. 브라우저 10개의 렌더링 부하나 10명의 동시 MCP 디자인 생성은 측정하지 않았습니다. [범위·결과·재현 방법](docs/VERIFICATION.md)을 확인하세요.

```sh
./penpot test
./penpot status
./penpot stop
./penpot up
```

테스트는 별도 임시 팀·파일·계정을 생성합니다. 중단된 테스트는 `./penpot test:cleanup`으로 정리할 수 있습니다. 결과는 무시되는 `test-results/`에 저장됩니다. `./penpot down`은 컨테이너·네트워크를 제거하고 DB·에셋 볼륨을 남깁니다. **`down -v`는 데이터를 지웁니다.**

## 구성과 저장

| 서비스 | 역할 |
| --- | --- |
| frontend | Penpot UI와 API·MCP 진입점 |
| backend | 인증·팀 권한·파일 저장 |
| postgres | 계정·권한·디자인 문서 DB |
| valkey | 실시간 협업과 작업 조율 |
| exporter | 이미지·PDF 등 내보내기 |
| mcp | 내장 MCP 도구 |

기본은 **컨테이너 6개를 한 서버에서 실행**합니다. 초기화·검사 때만 Node 도구 컨테이너를 일시적으로 실행합니다. Penpot 본체는 SQLite를 지원하지 않으며 이 구성도 PostgreSQL을 사용합니다. 이미지·업로드 폰트·기타 파일은 `assets` 볼륨에, 계정과 문서는 `database` 볼륨에 저장합니다. 로컬 브라우저 폰트는 업로드 에셋과 다릅니다. 두 볼륨과 `.env`를 함께 백업하세요.

지속 부하와 최소 RAM은 아직 측정하지 않았습니다. 컨테이너를 하나로 합치는 것이 필요한 서비스의 메모리를 없애지는 않습니다. [백업·배포·업데이트 안내](docs/OPERATIONS.md)를 확인하세요.

## 소스와 라이선스

이 저장소는 배포 구성·실행 도구·검증 코드입니다. 별도로 만들었던 Next.js/Vite 앱, 개인 디자인, DB, 계정 비밀번호와 MCP 키, Penpot 전체 소스 스냅샷은 올리지 않습니다. Penpot 소스를 개조하려면 [공식 저장소](https://github.com/penpot/penpot)를 별도 fork하고 버전을 맞춘 자체 이미지를 사용하세요.

이 키트는 [MPL-2.0](LICENSE)으로 배포합니다. Penpot 및 외부 이미지의 출처는 [NOTICES](NOTICES.md)에 기록했습니다.
