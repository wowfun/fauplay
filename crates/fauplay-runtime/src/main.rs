use std::env;
use std::fs;
use std::net::{SocketAddr, TcpListener};
use std::path::PathBuf;
use std::process;

use fauplay_runtime::{FauplayRuntime, RuntimeError, serve_fauplay_app};

const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1:3211";
const DEFAULT_WEB_DIST_PATH: &str = "dist";
const USAGE: &str = "usage: fauplay [--addr <host:port>]";

fn main() {
    if let Err(error) = run(env::args().skip(1).collect()) {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<(), CliError> {
    match args.as_slice() {
        [] => serve(
            DEFAULT_BIND_ADDRESS
                .parse()
                .map_err(CliError::InvalidBindAddress)?,
        ),
        [flag] if flag == "--help" || flag == "-h" => {
            println!("{USAGE}");
            Ok(())
        }
        [flag, bind_address] if flag == "--addr" => {
            serve(bind_address.parse().map_err(CliError::InvalidBindAddress)?)
        }
        _ => Err(CliError::Usage),
    }
}

fn serve(bind_address: SocketAddr) -> Result<(), CliError> {
    let web_dist_path = PathBuf::from(DEFAULT_WEB_DIST_PATH);
    ensure_web_app_build(&web_dist_path)?;
    let listener = TcpListener::bind(bind_address).map_err(CliError::Bind)?;
    let local_address = listener.local_addr().map_err(CliError::Bind)?;
    println!("listening\t{local_address}");
    println!("open\t{}", open_url_for_address(local_address));
    serve_fauplay_app(listener, FauplayRuntime::new(), web_dist_path)?;
    Ok(())
}

fn ensure_web_app_build(web_dist_path: &std::path::Path) -> Result<(), CliError> {
    let index_path = web_dist_path.join("index.html");
    if fs::metadata(&index_path).is_ok_and(|metadata| metadata.is_file()) {
        return Ok(());
    }

    Err(CliError::MissingWebAppBuild(index_path))
}

fn open_url_for_address(address: SocketAddr) -> String {
    match address {
        SocketAddr::V4(address) => format!("http://{}:{}/", address.ip(), address.port()),
        SocketAddr::V6(address) => format!("http://[{}]:{}/", address.ip(), address.port()),
    }
}

#[derive(Debug)]
enum CliError {
    Bind(std::io::Error),
    InvalidBindAddress(std::net::AddrParseError),
    MissingWebAppBuild(PathBuf),
    Runtime(RuntimeError),
    Usage,
}

impl From<RuntimeError> for CliError {
    fn from(error: RuntimeError) -> Self {
        Self::Runtime(error)
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CliError::Bind(error) => write!(formatter, "failed to bind Runtime API: {error}"),
            CliError::InvalidBindAddress(error) => {
                write!(formatter, "invalid bind address: {error}")
            }
            CliError::MissingWebAppBuild(index_path) => write!(
                formatter,
                "Web App build not found at {}; run `pnpm run build` before `pnpm run start`",
                index_path.display()
            ),
            CliError::Runtime(error) => write!(formatter, "{error}"),
            CliError::Usage => formatter.write_str(USAGE),
        }
    }
}
