use std::env;
use std::net::{SocketAddr, TcpListener};
use std::path::PathBuf;
use std::process;

use fauplay_runtime::{
    DirectoryEntryKind, FauplayRuntime, ListDirectoryRequest, RootRelativePath, RuntimeError,
    serve_http, serve_one_http_request,
};

fn main() {
    if let Err(error) = run(env::args().skip(1).collect()) {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<(), CliError> {
    match args.as_slice() {
        [command, root_path] if command == "list" => {
            list_directory(PathBuf::from(root_path), PathBuf::new())
        }
        [command, root_path, relative_path] if command == "list" => {
            list_directory(PathBuf::from(root_path), PathBuf::from(relative_path))
        }
        [command, bind_address] if command == "serve-once" => {
            serve_once(bind_address.parse().map_err(CliError::InvalidBindAddress)?)
        }
        [command, bind_address] if command == "serve" => {
            serve(bind_address.parse().map_err(CliError::InvalidBindAddress)?)
        }
        _ => Err(CliError::Usage),
    }
}

fn list_directory(root_path: PathBuf, relative_path: PathBuf) -> Result<(), CliError> {
    let runtime = FauplayRuntime::new();
    let root_relative_path = RootRelativePath::try_from(relative_path)?;
    let response = runtime.list_local_directory(ListDirectoryRequest {
        root_path,
        root_relative_path,
    })?;

    for entry in response.entries {
        println!(
            "{}\t{}",
            directory_entry_kind_label(entry.kind),
            entry.root_relative_path
        );
    }

    Ok(())
}

fn serve_once(bind_address: SocketAddr) -> Result<(), CliError> {
    let listener = TcpListener::bind(bind_address).map_err(CliError::Bind)?;
    let local_address = listener.local_addr().map_err(CliError::Bind)?;
    println!("listening\t{local_address}");
    serve_one_http_request(listener, FauplayRuntime::new())?;
    Ok(())
}

fn serve(bind_address: SocketAddr) -> Result<(), CliError> {
    let listener = TcpListener::bind(bind_address).map_err(CliError::Bind)?;
    let local_address = listener.local_addr().map_err(CliError::Bind)?;
    println!("listening\t{local_address}");
    serve_http(listener, FauplayRuntime::new())?;
    Ok(())
}

fn directory_entry_kind_label(kind: DirectoryEntryKind) -> &'static str {
    match kind {
        DirectoryEntryKind::Directory => "directory",
        DirectoryEntryKind::File => "file",
    }
}

#[derive(Debug)]
enum CliError {
    Bind(std::io::Error),
    InvalidBindAddress(std::net::AddrParseError),
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
            CliError::Runtime(error) => write!(formatter, "{error}"),
            CliError::Usage => formatter.write_str(
                "usage: fauplay-runtime list <root> [relative]\n       fauplay-runtime serve <addr>\n       fauplay-runtime serve-once <addr>",
            ),
        }
    }
}
